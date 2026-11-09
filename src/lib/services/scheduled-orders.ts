import { financialActionsUnavailable } from "@/lib/platform/financial-environment";
import { randomUUID } from "node:crypto";
import { scheduleWalletEmails } from "@/lib/email/schedule-wallet-emails";
import { db } from "@/db";
import { scheduledOrders, orders, users } from "@/db/schema";
import { eq, and, lte, ne, isNull } from "drizzle-orm";
import { logger } from "@/lib/platform/logger";
import { findPlan } from "@/lib/services/catalog";
import { FleexaError } from "@/lib/providers/fleexa";
import { fulfillPlan, fulfilmentIntent } from "@/lib/services/fulfillment";
import { isAmbiguousOtpPurchase } from "@/lib/services/numbers/otp-suppliers";
import { ORDER_PROVIDERS } from "@/lib/services/order-providers";
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

  return db.transaction(async (tx) => {
    const [account] = await tx.select({ id: users.id }).from(users)
      .where(and(eq(users.id, userId), isNull(users.suspendedAt), isNull(users.deletedAt))).for("update").limit(1);
    if (!account) throw new Error("Account unavailable");
    const [result] = await tx.insert(scheduledOrders).values({ userId, service, productSlug, frequency, nextRunAt, status: "active" })
      .returning({ id: scheduledOrders.id, nextRunAt: scheduledOrders.nextRunAt });
    return result;
  });
}

export async function pauseScheduledOrder(orderId: string, userId: string): Promise<boolean> {
  const [updated] = await db.update(scheduledOrders)
    .set({ status: "paused" })
    .where(and(eq(scheduledOrders.id, orderId), eq(scheduledOrders.userId, userId), eq(scheduledOrders.status, "active")))
    .returning({ id: scheduledOrders.id });
  return Boolean(updated);
}

export async function resumeScheduledOrder(orderId: string, userId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [account] = await tx.select({ id: users.id }).from(users)
      .where(and(eq(users.id, userId), isNull(users.suspendedAt), isNull(users.deletedAt))).for("update").limit(1);
    if (!account) return false;
    const [order] = await tx.select().from(scheduledOrders)
      .where(and(eq(scheduledOrders.id, orderId), eq(scheduledOrders.userId, userId), eq(scheduledOrders.status, "paused")))
      .for("update").limit(1);
    if (!order) return false;
    // A claimed run whose paid outcome is unknown must be reconciled before the
    // customer can cause another provider call by resuming the schedule.
    if (order.lastOrderId) {
      const [last] = await tx.select({ status: orders.status }).from(orders)
        .where(and(eq(orders.id, order.lastOrderId), eq(orders.userId, userId))).limit(1);
      if (last?.status === "review" || last?.status === "processing") return false;
    }
    const nextRunAt = calculateNextRun(order.frequency as Frequency);
    const [updated] = await tx.update(scheduledOrders).set({ status: "active", nextRunAt })
      .where(and(eq(scheduledOrders.id, orderId), eq(scheduledOrders.userId, userId), eq(scheduledOrders.status, "paused")))
      .returning({ id: scheduledOrders.id });
    return Boolean(updated);
  });
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
 * Claim a due run and its review order before any supplier call. The claim has
 * no timeout: after a crash it remains visible for reconciliation, rather than
 * causing the next sweep to buy a second unit. Suspension and claims lock the
 * account before the schedule, in that order.
 */
export async function processScheduledOrder(scheduled: typeof scheduledOrders.$inferSelect): Promise<boolean> {
  if (financialActionsUnavailable()) return false;
  const now = new Date();
  const plan = typeof scheduled.productSlug === "string" ? findPlan(scheduled.productSlug) : undefined;
  if (!plan || scheduled.service !== plan.service) throw new Error("Invalid scheduled product");
  const intent = fulfilmentIntent(plan.slug);
  if (!intent) return false;
  const orderId = randomUUID();
  const reference = makeReference("SCH");

  const current = await db.transaction(async (tx) => {
    const [account] = await tx.select({ walletBalance: users.walletBalance, suspendedAt: users.suspendedAt, deletedAt: users.deletedAt })
      .from(users).where(eq(users.id, scheduled.userId)).for("update").limit(1);
    if (!account || account.suspendedAt || account.deletedAt || account.walletBalance < plan.price) return null;
    const [row] = await tx.select().from(scheduledOrders)
      .where(and(eq(scheduledOrders.id, scheduled.id), eq(scheduledOrders.userId, scheduled.userId), eq(scheduledOrders.status, "active"), lte(scheduledOrders.nextRunAt, now)))
      .for("update").limit(1);
    if (!row || row.productSlug !== plan.slug || row.service !== plan.service) return null;
    await tx.insert(orders).values({
      id: orderId, reference, userId: row.userId, service: row.service, productSlug: row.productSlug,
      productName: plan.name, planLabel: plan.planLabel, region: plan.region, duration: plan.duration,
      amount: plan.price, status: "review", provider: intent.kind === "sms" ? ORDER_PROVIDERS.bitcall : ORDER_PROVIDERS.fleexa,
      reconciliationNote: "Scheduled run claimed before provider call; nothing has been charged.",
    });
    await tx.update(scheduledOrders).set({ status: "processing", lastOrderId: orderId }).where(eq(scheduledOrders.id, row.id));
    return row;
  });
  if (!current) return false;

  let started = false;
  const markAttempt = async () => {
    await db.transaction(async (tx) => {
      const [account] = await tx.select({ suspendedAt: users.suspendedAt, deletedAt: users.deletedAt })
        .from(users).where(eq(users.id, current.userId)).for("update").limit(1);
      if (!account || account.suspendedAt || account.deletedAt) throw new Error("Account unavailable");
      const [run] = await tx.select({ id: scheduledOrders.id }).from(scheduledOrders)
        .where(and(eq(scheduledOrders.id, current.id), eq(scheduledOrders.status, "processing"), eq(scheduledOrders.lastOrderId, orderId)))
        .for("update").limit(1);
      if (!run) throw new Error("Schedule no longer running");
      const [order] = await tx.update(orders).set({ reconciliationNote: "Scheduled provider call started; outcome requires reconciliation if not completed." })
        .where(and(eq(orders.id, orderId), eq(orders.status, "review"))).returning({ id: orders.id });
      if (!order) throw new Error("Scheduled order claim unavailable");
    });
    started = true;
  };
  const recordAccepted = async (providerRequestId: string) => {
    const [order] = await db.update(orders).set({ providerRequestId, reconciliationNote: "Scheduled provider accepted; wallet charge is pending reconciliation." })
      .where(and(eq(orders.id, orderId), eq(orders.status, "review"))).returning({ id: orders.id });
    if (!order) throw new Error("Scheduled order claim unavailable");
  };

  let fulfilled;
  try {
    fulfilled = await fulfillPlan(plan, {
      onOtpAttempt: markAttempt, onOtpAccepted: recordAccepted,
      onRentalAttempt: markAttempt, onRentalAccepted: recordAccepted,
    });
    // This also records the rental reference. For OTP it is an idempotent update.
    if (fulfilled.providerRequestId) await recordAccepted(fulfilled.providerRequestId);
  } catch (error) {
    const ambiguous = (started && (intent.kind !== "sms" || isAmbiguousOtpPurchase(error))) ||
      (error instanceof FleexaError && error.code === "AMBIGUOUS_PURCHASE");
    if (ambiguous) {
      await db.transaction(async (tx) => {
        await tx.update(orders).set({ reconciliationNote: "Scheduled purchase outcome is uncertain; nothing was charged. Reconcile before retrying." })
          .where(and(eq(orders.id, orderId), eq(orders.status, "review")));
        await tx.update(scheduledOrders).set({ status: "paused" })
          .where(and(eq(scheduledOrders.id, current.id), eq(scheduledOrders.status, "processing"), eq(scheduledOrders.lastOrderId, orderId)));
      });
      logger.error("Scheduled purchase requires reconciliation", { scheduledOrderId: current.id, orderId });
      return false;
    }
    // No provider purchase began, or the provider definitively refused it.
    await db.transaction(async (tx) => {
      const [account] = await tx.select({ suspendedAt: users.suspendedAt, deletedAt: users.deletedAt })
        .from(users).where(eq(users.id, current.userId)).for("update").limit(1);
      await tx.update(orders).set({ status: "cancelled", reconciliationNote: "Scheduled provider purchase did not start or was refused; nothing was charged." })
        .where(and(eq(orders.id, orderId), eq(orders.status, "review")));
      await tx.update(scheduledOrders).set({ status: account && !account.suspendedAt && !account.deletedAt ? "active" : "paused" })
        .where(and(eq(scheduledOrders.id, current.id), eq(scheduledOrders.status, "processing"), eq(scheduledOrders.lastOrderId, orderId)));
    });
    return false;
  }

  try {
    await db.transaction(async (tx) => {
      const [account] = await tx.select({ suspendedAt: users.suspendedAt, deletedAt: users.deletedAt })
        .from(users).where(eq(users.id, current.userId)).for("update").limit(1);
      if (!account) throw new Error("Account unavailable");
      const [activated] = await tx.update(orders).set({
        status: "active", provider: fulfilled.provider, providerCostNgn: fulfilled.providerCostNgn,
        providerRequestId: fulfilled.providerRequestId, referenceCode: fulfilled.referenceCode,
        otpCode: fulfilled.otpCode, expiresAt: fulfilled.expiresAt, reconciliationNote: null,
      }).where(and(eq(orders.id, orderId), eq(orders.status, "review"))).returning({ id: orders.id });
      if (!activated) throw new Error("Scheduled order claim unavailable");
      await debitWalletInTx(tx, { userId: current.userId, amount: plan.price, type: "debit", description: `Scheduled purchase: ${plan.name}`, orderId, reference });
      await tx.update(scheduledOrders).set({
        status: account.suspendedAt || account.deletedAt ? "paused" : "active",
        lastRunAt: now, nextRunAt: calculateNextRun(current.frequency as Frequency, now),
      }).where(and(eq(scheduledOrders.id, current.id), eq(scheduledOrders.status, "processing"), eq(scheduledOrders.lastOrderId, orderId)));
    });
    scheduleWalletEmails();
    return true;
  } catch {
    // The transaction might have committed before the connection failed. Never
    // cancel an accepted provider purchase based on an uncertain DB response.
    const [saved] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)).limit(1);
    if (saved?.status === "active") return true;
    await db.update(orders).set({ providerRequestId: fulfilled.providerRequestId, providerCostNgn: fulfilled.providerCostNgn,
      reconciliationNote: "Provider accepted the scheduled purchase; wallet charge requires reconciliation." })
      .where(and(eq(orders.id, orderId), eq(orders.status, "review")));
    await db.update(scheduledOrders).set({ status: "paused" })
      .where(and(eq(scheduledOrders.id, current.id), eq(scheduledOrders.status, "processing"), eq(scheduledOrders.lastOrderId, orderId)));
    logger.error("Scheduled purchase charge requires reconciliation", { scheduledOrderId: current.id, orderId });
    return false;
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
