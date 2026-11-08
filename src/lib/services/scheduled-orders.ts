import { financialActionsUnavailable } from "@/lib/platform/financial-environment";
import { randomUUID } from "node:crypto";
import { scheduleWalletEmails } from "@/lib/email/schedule-wallet-emails";
import { db } from "@/db";
import { scheduledOrders, orders, users } from "@/db/schema";
import { eq, and, lte, ne } from "drizzle-orm";
import { logger } from "@/lib/platform/logger";
import { findPlan } from "@/lib/services/catalog";
import { FleexaError } from "@/lib/providers/fleexa";
import { cancelUpstream, fulfillPlan, fulfilmentIntent } from "@/lib/services/fulfillment";
import { makeReference, debitWalletInTx } from "@/lib/payments/wallet";

export type Frequency = "daily" | "weekly" | "biweekly" | "monthly";

export async function createScheduledOrder(params: {
  userId: string;
  service: string;
  productSlug: string;
  frequency: Frequency;
}): Promise<{ id: string; nextRunAt: Date }> {
  const { userId, service, productSlug, frequency } = params;

  const plan = findPlan(productSlug);
  if (!plan || plan.service !== service) {
    throw new Error("Invalid product or service");
  }
  // A schedule that can only ever fail is not a product. Only plans with a
  // supplier path may recur, so a run can always be delivered and charged in
  // that order.
  if (!fulfilmentIntent(productSlug)) {
    throw new Error("That plan cannot be delivered automatically, so it cannot be scheduled.");
  }
  if (!["daily", "weekly", "biweekly", "monthly"].includes(frequency)) {
    throw new Error("Invalid frequency");
  }

  const nextRunAt = calculateNextRun(frequency);

  const [result] = await db
    .insert(scheduledOrders)
    .values({
      userId,
      service,
      productSlug,
      frequency,
      nextRunAt,
      status: "active",
    })
    .returning({ id: scheduledOrders.id, nextRunAt: scheduledOrders.nextRunAt });

  return result;
}

export async function pauseScheduledOrder(orderId: string, userId: string): Promise<boolean> {
  const [updated] = await db.update(scheduledOrders)
    .set({ status: "paused" })
    .where(and(eq(scheduledOrders.id, orderId), eq(scheduledOrders.userId, userId), eq(scheduledOrders.status, "active")))
    .returning({ id: scheduledOrders.id });
  return Boolean(updated);
}

export async function resumeScheduledOrder(orderId: string, userId: string): Promise<boolean> {
  const order = await db.query.scheduledOrders.findFirst({
    where: and(eq(scheduledOrders.id, orderId), eq(scheduledOrders.userId, userId), eq(scheduledOrders.status, "paused")),
  });
  if (!order) return false;
  const nextRunAt = calculateNextRun(order.frequency as Frequency);
  const [updated] = await db.update(scheduledOrders)
    .set({ status: "active", nextRunAt })
    .where(and(eq(scheduledOrders.id, orderId), eq(scheduledOrders.userId, userId), eq(scheduledOrders.status, "paused")))
    .returning({ id: scheduledOrders.id });
  return Boolean(updated);
}

export async function cancelScheduledOrder(orderId: string, userId: string): Promise<boolean> {
  const [updated] = await db.update(scheduledOrders)
    .set({ status: "cancelled" })
    .where(and(eq(scheduledOrders.id, orderId), eq(scheduledOrders.userId, userId), ne(scheduledOrders.status, "cancelled")))
    .returning({ id: scheduledOrders.id });
  return Boolean(updated);
}

export async function getUserScheduledOrders(userId: string) {
  return db.query.scheduledOrders.findMany({
    where: eq(scheduledOrders.userId, userId),
    orderBy: (orders, { desc }) => [desc(orders.createdAt)],
    limit: 100,
  });
}

/**
 * This run is not ours to make: the row moved under us, or the money did.
 *
 * Thrown rather than returned so the transaction rolls back and one `catch`
 * decides what a declined run owes the supplier.
 */
class RunDeclinedError extends Error {
  constructor() {
    super("Scheduled run declined");
    this.name = "RunDeclinedError";
  }
}

/**
 * Atomically execute one due run.
 *
 * The old version debited the wallet, wrote an order marked `delivered` with
 * provider `scheduled`, and never called a supplier: the customer paid for
 * nothing, and the order said it had arrived. This one buys first — the same
 * `fulfillPlan` a manual purchase uses — and only then records and charges. A
 * refused or unreachable supplier leaves the money where it was and the run is
 * skipped, so the next scheduled time can try again.
 *
 * Buying before claiming is what makes the release path matter: if the row turns
 * out not to be ours to run — paused, already run by the sweep that overlapped
 * this one, balance moved under us — the number has already been bought and has
 * to go back, or the business pays a supplier for a number nobody holds.
 */
export async function processScheduledOrder(scheduled: typeof scheduledOrders.$inferSelect): Promise<boolean> {
  if (financialActionsUnavailable()) return false;
  const now = new Date();
  const plan = typeof scheduled.productSlug === "string" ? findPlan(scheduled.productSlug) : undefined;
  if (!plan || scheduled.service !== plan.service) throw new Error("Invalid scheduled product");
  if (!fulfilmentIntent(plan.slug)) {
    console.error("Scheduled run skipped: plan has no supplier path", { scheduledOrderId: scheduled.id, slug: plan.slug });
    return false;
  }

  // Re-read before spending anything: the cron can hand over a row that another
  // instance has already run or that the customer has paused.
  const [current] = await db
    .select()
    .from(scheduledOrders)
    .where(and(eq(scheduledOrders.id, scheduled.id), eq(scheduledOrders.userId, scheduled.userId), eq(scheduledOrders.status, "active")))
    .limit(1);
  if (!current) return false;
  const due = new Date(current.nextRunAt as Date | string).getTime();
  if (!Number.isFinite(due) || due > now.getTime()) return false;

  const [account] = await db
    .select({ walletBalance: users.walletBalance })
    .from(users)
    .where(eq(users.id, current.userId))
    .limit(1);
  if (!account || !Number.isSafeInteger(account.walletBalance) || account.walletBalance < plan.price) return false;

  let fulfilled;
  try {
    fulfilled = await fulfillPlan(plan);
  } catch (error) {
    // An ambiguous paid call may have created an activation. Stop future sweeps
    // until an operator reconciles it instead of automatically buying again.
    if (error instanceof FleexaError && error.code === "AMBIGUOUS_PURCHASE") {
      await db.update(scheduledOrders).set({ status: "paused" })
        .where(and(eq(scheduledOrders.id, current.id), eq(scheduledOrders.status, "active")));
      console.error("Scheduled purchase outcome unknown; schedule paused for reconciliation", { scheduledOrderId: current.id, slug: plan.slug });
      return false;
    }
    // A refusal leaves the wallet untouched; the schedule remains active.
    console.error("Scheduled fulfilment unavailable; run skipped", {
      scheduledOrderId: current.id,
      slug: plan.slug,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }

  const nextRunAt = calculateNextRun(current.frequency as Frequency, now);
  const reference = makeReference("SCH");
  const orderId = randomUUID();

  // One release path for both ways this run can back out: the transaction
  // declining, and the transaction failing. `cancelUpstream` is the only thing
  // standing between a bought number and nobody holding it.
  const release = () =>
    cancelUpstream({
      provider: fulfilled.provider,
      providerRequestId: fulfilled.providerRequestId,
      service: plan.service,
      duration: plan.duration,
    }).catch((cancelError) => {
      console.error("Scheduled upstream cancel failed", cancelError);
    });

  try {
    return await db.transaction(async (tx: any): Promise<boolean> => {
      // `FOR UPDATE`, on the row this run is about to spend: two sweeps that both
      // picked this schedule out of the due list used to read the same past
      // `nextRunAt`, both see it as still due, and both buy and both charge. The
      // nightly job and `/api/cron/scheduled-orders` are separate requests, and
      // Vercel can overlap two invocations of either. Blocking here makes the
      // loser re-read the row as the winner left it — next run advanced — decline,
      // and give the number back.
      const [fresh] = await tx
        .select()
        .from(scheduledOrders)
        .where(and(eq(scheduledOrders.id, current.id), eq(scheduledOrders.status, "active")))
        .for("update")
        .limit(1);
      if (!fresh || new Date(fresh.nextRunAt as Date | string).getTime() > now.getTime()) {
        throw new RunDeclinedError();
      }

      const [wallet] = await tx
        .select({ walletBalance: users.walletBalance })
        .from(users)
        .where(eq(users.id, current.userId))
        .limit(1);
      if (!wallet || wallet.walletBalance < plan.price) throw new RunDeclinedError();

      await tx.insert(orders).values({
        id: orderId,
        reference,
        userId: current.userId,
        service: current.service,
        productSlug: current.productSlug,
        productName: plan.name,
        planLabel: plan.planLabel,
        region: plan.region,
        duration: plan.duration,
        amount: plan.price,
        // A code may still be on its way, exactly as for a manual purchase.
        status: "active",
        provider: fulfilled.provider,
        providerCostNgn: fulfilled.providerCostNgn,
        providerRequestId: fulfilled.providerRequestId,
        referenceCode: fulfilled.referenceCode,
        otpCode: fulfilled.otpCode,
        expiresAt: fulfilled.expiresAt,
        createdAt: now,
      });

      await debitWalletInTx(tx, {
        userId: current.userId,
        amount: plan.price,
        type: "debit",
        description: `Scheduled purchase: ${plan.name}`,
        orderId,
        reference,
      });

      await tx
        .update(scheduledOrders)
        .set({ lastRunAt: now, lastOrderId: orderId, nextRunAt })
        .where(eq(scheduledOrders.id, current.id));

      return true;
    });
  } catch (error) {
    await release();
    if (error instanceof RunDeclinedError) return false;
    throw error;
  }
}

export type ScheduledRunCounts = { processed: number; skipped: number; failed: number; deferred: number };

/** A run has to finish inside the cron request, so it stops buying before that. */
const DEFAULT_RUN_LIMIT = 20;
const DEFAULT_RUN_BUDGET_MS = 40_000;

/**
 * Run every due schedule, once.
 *
 * The nightly job calls this; `/api/cron/scheduled-orders` does too, for a manual
 * run. Both get the same counts, because "processed 0" and "there was nothing to
 * do" are different answers and only one of them means the wiring works.
 */
export async function runScheduledOrders(
  options: { limit?: number; budgetMs?: number } = {},
): Promise<ScheduledRunCounts> {
  const limit = options.limit ?? DEFAULT_RUN_LIMIT;
  const budgetMs = options.budgetMs ?? DEFAULT_RUN_BUDGET_MS;
  const startedAt = Date.now();
  const dueOrders = await db.query.scheduledOrders.findMany({
    where: and(eq(scheduledOrders.status, "active"), lte(scheduledOrders.nextRunAt, new Date())),
    limit,
  });
  const counts: ScheduledRunCounts = { processed: 0, skipped: 0, failed: 0, deferred: 0 };
  for (const [index, scheduled] of dueOrders.entries()) {
    // Each run buys from a supplier before charging, so one slow supplier can eat
    // the whole cron window. Anything not reached stays due and is picked up
    // tomorrow -- it was never charged, so deferring costs the customer nothing.
    if (Date.now() - startedAt > budgetMs) {
      counts.deferred = dueOrders.length - index;
      logger.warn("Scheduled run out of budget", { deferred: counts.deferred, budgetMs });
      break;
    }
    try {
      if (await processScheduledOrder(scheduled)) {
        counts.processed++;
        scheduleWalletEmails();
      } else counts.skipped++;
    } catch (error) {
      counts.failed++;
      logger.error("Failed to process scheduled order", {
        scheduledOrderId: scheduled.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return counts;
}

/** The processed count, for callers that only want the headline number. */
export async function processScheduledOrders(): Promise<number> {
  return (await runScheduledOrders()).processed;
}

export function calculateNextRun(frequency: Frequency, from = new Date()): Date {
  const now = new Date(from);
  switch (frequency) {
    case "daily":
      now.setDate(now.getDate() + 1);
      break;
    case "weekly":
      now.setDate(now.getDate() + 7);
      break;
    case "biweekly":
      now.setDate(now.getDate() + 14);
      break;
    case "monthly": {
      const day = now.getDate();
      now.setDate(1);
      now.setMonth(now.getMonth() + 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      now.setDate(Math.min(day, lastDay));
      break;
    }
    default:
      throw new Error("Invalid frequency");
  }
  return now;
}
