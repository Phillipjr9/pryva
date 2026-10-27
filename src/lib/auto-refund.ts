import { db } from "@/db";
import { orders, walletTransactions, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { isTimedOut } from "./service-timeouts";
import { isRefundEligible } from "./gift-cards";

export async function processAutoRefunds(): Promise<number> {
  const pendingOrders = await db.query.orders.findMany({
    where: eq(orders.status, "active"),
  });

  let refunded = 0;

  for (const order of pendingOrders) {
    try {
      // Check if order is eligible for refund
      if (!isRefundEligible({ type: "debit", description: order.productName })) {
        continue;
      }

      // Check if order has timed out
      if (!isTimedOut(order.createdAt, order.service)) {
        continue;
      }

      // Process refund
      await db.transaction(async (tx) => {
        const user = await tx.query.users.findFirst({
          where: eq(users.id, order.userId),
        });

        if (!user) return;

        const newBalance = user.walletBalance + order.amount;

        await tx.update(users).set({ walletBalance: newBalance }).where(eq(users.id, order.userId));

        await tx
          .update(orders)
          .set({ status: "refunded", refundedAt: new Date() })
          .where(eq(orders.id, order.id));

        await tx.insert(walletTransactions).values({
          userId: order.userId,
          orderId: order.id,
          type: "credit",
          amount: order.amount,
          balanceAfter: newBalance,
          description: `Auto-refund: ${order.productName} (delivery timeout)`,
          reference: `REFUND-${order.reference}`,
        });
      });

      refunded++;
    } catch (error) {
      console.error(`Failed to process refund for order ${order.id}:`, error);
    }
  }

  return refunded;
}

export async function refundOrder(orderId: string, reason: string = "Manual refund"): Promise<void> {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
  });

  if (!order) {
    throw new Error("Order not found");
  }

  if (order.status === "refunded") {
    throw new Error("Order already refunded");
  }

  if (!isRefundEligible({ type: "debit", description: order.productName })) {
    throw new Error("Order not eligible for refund");
  }

  await db.transaction(async (tx) => {
    const user = await tx.query.users.findFirst({
      where: eq(users.id, order.userId),
    });

    if (!user) throw new Error("User not found");

    const newBalance = user.walletBalance + order.amount;

    await tx.update(users).set({ walletBalance: newBalance }).where(eq(users.id, order.userId));

    await tx
      .update(orders)
      .set({ status: "refunded", refundedAt: new Date() })
      .where(eq(orders.id, order.id));

    await tx.insert(walletTransactions).values({
      userId: order.userId,
      orderId: order.id,
      type: "credit",
      amount: order.amount,
      balanceAfter: newBalance,
      description: `Refund: ${order.productName} (${reason})`,
      reference: `REFUND-${order.reference}`,
    });
  });
}

export async function getOrderRefundStatus(orderId: string): Promise<{
  refundable: boolean;
  reason?: string;
  timeoutRemaining?: number;
}> {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
  });

  if (!order) {
    return { refundable: false, reason: "Order not found" };
  }

  if (order.status === "refunded") {
    return { refundable: false, reason: "Already refunded" };
  }

  if (order.status === "delivered") {
    return { refundable: false, reason: "Order delivered successfully" };
  }

  if (!isRefundEligible({ type: "debit", description: order.productName })) {
    return { refundable: false, reason: "Not eligible for refund" };
  }

  return { refundable: true };
}
