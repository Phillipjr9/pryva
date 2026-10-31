import { randomUUID } from "node:crypto";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { db, mutatePreviewDatabase } from "@/db";
import { scheduledOrders, orders, users } from "@/db/schema";
import { eq, and, lte, ne } from "drizzle-orm";
import { findPlan } from "./catalog";
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

/** Atomically execute one due run. */
export async function processScheduledOrder(scheduled: typeof scheduledOrders.$inferSelect): Promise<boolean> {
  const now = new Date();
  if (isPreviewDatabase()) {
    return mutatePreviewDatabase((draft) => {
      const current = draft.scheduledOrders.find((row) => row.id === scheduled.id && row.userId === scheduled.userId);
      if (!current || current.status !== "active") return false;
      const due = new Date(current.nextRunAt as Date | string).getTime();
      if (!Number.isFinite(due)) throw new Error("Invalid scheduled run time");
      if (due > now.getTime()) return false;
      const plan = typeof current.productSlug === "string" ? findPlan(current.productSlug) : undefined;
      if (!plan || current.service !== plan.service) throw new Error("Invalid scheduled product");
      const nextRunAt = calculateNextRun(current.frequency as Frequency, now);
      const account = draft.users.find((row) => row.id === current.userId);
      if (!account || !Number.isSafeInteger(account.walletBalance) || (account.walletBalance as number) < plan.price) return false;
      const newBalance = (account.walletBalance as number) - plan.price;
      const reference = makeReference("SCH");
      const orderId = randomUUID();
      draft.orders.push({
        id: orderId, reference, userId: current.userId, service: current.service,
        productSlug: current.productSlug, productName: plan.name, planLabel: plan.planLabel,
        region: plan.region, duration: plan.duration, amount: plan.price,
        status: "delivered", provider: "scheduled", createdAt: now,
      });
      draft.walletTransactions.push({
        id: randomUUID(), userId: current.userId, orderId, type: "debit", amount: plan.price,
        balanceAfter: newBalance, description: `Scheduled purchase: ${plan.name}`, reference, createdAt: now,
      });
      account.walletBalance = newBalance;
      current.lastRunAt = now;
      current.lastOrderId = orderId;
      current.nextRunAt = nextRunAt;
      return true;
    });
  }

  const plan = typeof scheduled.productSlug === "string" ? findPlan(scheduled.productSlug) : undefined;
  if (!plan || scheduled.service !== plan.service) throw new Error("Invalid scheduled product");
  const nextRunAt = calculateNextRun(scheduled.frequency as Frequency, now);
  const reference = makeReference("SCH");
  const orderId = randomUUID();

  return await db.transaction(async (tx: any) => {
    const [current] = await tx
      .select()
      .from(scheduledOrders)
      .where(and(eq(scheduledOrders.id, scheduled.id), eq(scheduledOrders.status, "active")))
      .limit(1);
    if (!current) return false;
    const due = new Date(current.nextRunAt as Date | string).getTime();
    if (!Number.isFinite(due) || due > now.getTime()) return false;

    const [account] = await tx
      .select({ walletBalance: users.walletBalance })
      .from(users)
      .where(eq(users.id, current.userId))
      .limit(1);
    if (!account || !Number.isSafeInteger(account.walletBalance) || account.walletBalance < plan.price) return false;

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
      status: "delivered",
      provider: "scheduled",
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
      .set({
        lastRunAt: now,
        lastOrderId: orderId,
        nextRunAt,
      })
      .where(eq(scheduledOrders.id, current.id));

    return true;
  });
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
