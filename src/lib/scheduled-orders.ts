import { isPreviewDatabase } from "@/lib/demo-policy";
import { db } from "@/db";
import { scheduledOrders, orders, users, walletTransactions } from "@/db/schema";
import { eq, and, lte } from "drizzle-orm";
import { findPlan } from "./catalog";

export type Frequency = "daily" | "weekly" | "biweekly" | "monthly";

export async function createScheduledOrder(params: {
  userId: string;
  service: string;
  productSlug: string;
  frequency: Frequency;
}): Promise<{ id: string; nextRunAt: Date }> {
  const { userId, service, productSlug, frequency } = params;

  const plan = findPlan(productSlug);
  if (!plan) {
    throw new Error("Invalid product");
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

export async function pauseScheduledOrder(orderId: string, userId: string): Promise<void> {
  await db
    .update(scheduledOrders)
    .set({ status: "paused" })
    .where(and(eq(scheduledOrders.id, orderId), eq(scheduledOrders.userId, userId)));
}

export async function resumeScheduledOrder(orderId: string, userId: string): Promise<void> {
  const order = await db.query.scheduledOrders.findFirst({
    where: and(eq(scheduledOrders.id, orderId), eq(scheduledOrders.userId, userId)),
  });

  if (!order) {
    throw new Error("Scheduled order not found");
  }

  const nextRunAt = calculateNextRun(order.frequency as Frequency);

  await db
    .update(scheduledOrders)
    .set({ status: "active", nextRunAt })
    .where(eq(scheduledOrders.id, orderId));
}

export async function cancelScheduledOrder(orderId: string, userId: string): Promise<void> {
  await db
    .update(scheduledOrders)
    .set({ status: "cancelled" })
    .where(and(eq(scheduledOrders.id, orderId), eq(scheduledOrders.userId, userId)));
}

export async function getUserScheduledOrders(userId: string) {
  return db.query.scheduledOrders.findMany({
    where: eq(scheduledOrders.userId, userId),
    orderBy: (orders, { desc }) => [desc(orders.createdAt)],
  });
}

export async function processScheduledOrder(scheduled: typeof scheduledOrders.$inferSelect): Promise<void> {
  if (!isPreviewDatabase()) throw new Error("Live scheduled fulfillment is not configured");
  const plan = findPlan(scheduled.productSlug);
  if (!plan) {
    throw new Error("Invalid product");
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, scheduled.userId),
  });

  if (!user || user.walletBalance < plan.price) {
    throw new Error("Insufficient balance");
  }

  await db.transaction(async (tx) => {
    const newBalance = user.walletBalance - plan.price;

    await tx.update(users).set({ walletBalance: newBalance }).where(eq(users.id, scheduled.userId));

    const reference = `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    const [order] = await tx
      .insert(orders)
      .values({
        reference,
        userId: scheduled.userId,
        service: scheduled.service,
        productSlug: scheduled.productSlug,
        productName: plan.name,
        planLabel: plan.planLabel,
        region: plan.region,
        duration: plan.duration,
        amount: plan.price,
        status: "delivered",
        provider: "scheduled",
      })
      .returning();

    await tx.insert(walletTransactions).values({
      userId: scheduled.userId,
      orderId: order.id,
      type: "debit",
      amount: plan.price,
      balanceAfter: newBalance,
      description: `Scheduled purchase: ${plan.name}`,
      reference,
    });

    const nextRunAt = calculateNextRun(scheduled.frequency as Frequency);

    await tx
      .update(scheduledOrders)
      .set({
        lastRunAt: new Date(),
        lastOrderId: order.id,
        nextRunAt,
      })
      .where(eq(scheduledOrders.id, scheduled.id));
  });
}

export async function processScheduledOrders(): Promise<number> {
  if (!isPreviewDatabase()) throw new Error("Live scheduled fulfillment is not configured");
  const now = new Date();
  const dueOrders = await db.query.scheduledOrders.findMany({
    where: and(
      eq(scheduledOrders.status, "active"),
      lte(scheduledOrders.nextRunAt, now),
    ),
  });

  let processed = 0;

  for (const scheduled of dueOrders) {
    try {
      const plan = findPlan(scheduled.productSlug);
      if (!plan) continue;

      const user = await db.query.users.findFirst({
        where: eq(users.id, scheduled.userId),
      });

      if (!user || user.walletBalance < plan.price) {
        continue;
      }

      await db.transaction(async (tx) => {
        const newBalance = user.walletBalance - plan.price;

        await tx.update(users).set({ walletBalance: newBalance }).where(eq(users.id, scheduled.userId));

        const reference = `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

        const [order] = await tx
          .insert(orders)
          .values({
            reference,
            userId: scheduled.userId,
            service: scheduled.service,
            productSlug: scheduled.productSlug,
            productName: plan.name,
            planLabel: plan.planLabel,
            region: plan.region,
            duration: plan.duration,
            amount: plan.price,
            status: "delivered",
            provider: "scheduled",
          })
          .returning();

        await tx.insert(walletTransactions).values({
          userId: scheduled.userId,
          orderId: order.id,
          type: "debit",
          amount: plan.price,
          balanceAfter: newBalance,
          description: `Scheduled purchase: ${plan.name}`,
          reference,
        });

        const nextRunAt = calculateNextRun(scheduled.frequency as Frequency);

        await tx
          .update(scheduledOrders)
          .set({
            lastRunAt: now,
            lastOrderId: order.id,
            nextRunAt,
          })
          .where(eq(scheduledOrders.id, scheduled.id));
      });

      processed++;
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
  }
  return now;
}
