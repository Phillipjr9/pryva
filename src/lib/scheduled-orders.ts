import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { scheduledOrders, orders, users } from "@/db/schema";
import { eq, and, lte, ne } from "drizzle-orm";
import { findPlan } from "./catalog";
import { cancelUpstream, fulfillPlan, fulfilmentIntent } from "./fulfillment";
import { makeReference, debitWalletInTx } from "./wallet";

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
 * Atomically execute one due run.
 *
 * The old version debited the wallet, wrote an order marked `delivered` with
 * provider `scheduled`, and never called a supplier: the customer paid for
 * nothing, and the order said it had arrived. This one buys first — the same
 * `fulfillPlan` a manual purchase uses — and only then records and charges. A
 * refused or unreachable supplier leaves the money where it was and the run is
 * skipped, so the next scheduled time can try again.
 */
export async function processScheduledOrder(scheduled: typeof scheduledOrders.$inferSelect): Promise<boolean> {
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
    // Nothing bought, nothing charged. Leaving the row active lets the next run
    // try again once the supplier is back.
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

  try {
    return await db.transaction(async (tx: any): Promise<boolean> => {
      const [fresh] = await tx
        .select()
        .from(scheduledOrders)
        .where(and(eq(scheduledOrders.id, current.id), eq(scheduledOrders.status, "active")))
        .limit(1);
      if (!fresh || new Date(fresh.nextRunAt as Date | string).getTime() > now.getTime()) return false;

      const [wallet] = await tx
        .select({ walletBalance: users.walletBalance })
        .from(users)
        .where(eq(users.id, current.userId))
        .limit(1);
      if (!wallet || wallet.walletBalance < plan.price) return false;

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
    // The purchase was made but never recorded or charged: release it rather
    // than holding a paid-for number nobody can see.
    try {
      await cancelUpstream({
        provider: fulfilled.provider,
        providerRequestId: fulfilled.providerRequestId,
        service: plan.service,
        duration: plan.duration,
      });
    } catch (cancelError) {
      console.error("Scheduled upstream cancel failed", cancelError);
    }
    throw error;
  }
}

export async function processScheduledOrders(): Promise<number> {
  const dueOrders = await db.query.scheduledOrders.findMany({
    where: and(eq(scheduledOrders.status, "active"), lte(scheduledOrders.nextRunAt, new Date())),
    limit: 50,
  });
  let processed = 0;
  for (const scheduled of dueOrders) {
    try {
      if (await processScheduledOrder(scheduled)) processed++;
    } catch (error) {
      console.error(`Failed to process scheduled order ${scheduled.id}:`, error);
    }
  }
  return processed;
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
