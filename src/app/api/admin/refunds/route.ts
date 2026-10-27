import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { db } from "@/db";
import { orders, users, walletTransactions } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// GET /api/admin/refunds - List orders eligible for refund or with pending refunds
export async function GET(request: NextRequest) {
    const admin = await requireAdminApi();
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  try {
    const { searchParams } = request.nextUrl;
    const status = searchParams.get("status") || "pending"; // pending, processed, all

    let query = db.select().from(orders);

    if (status === "pending") {
      query = query.where(
        and(
          sql`${orders.status} = 'failed'`,
          sql`${orders.refundedAt} IS NULL`
        )
      ) as typeof query;
    } else if (status === "processed") {
      query = query.where(sql`${orders.refundedAt} IS NOT NULL`) as typeof query;
    }

    const refundOrders = await query.limit(100);

    return NextResponse.json({
      ok: true,
      orders: refundOrders.map((o) => ({
        id: o.id,
        reference: o.reference,
        userId: o.userId,
        productName: o.productName,
        amount: o.amount,
        status: o.status,
        refundedAt: o.refundedAt,
        createdAt: o.createdAt,
      })),
      count: refundOrders.length,
    });
  } catch (error) {
    logger.error("Failed to fetch refunds", { error });
    return NextResponse.json({ error: "Failed to fetch refunds" }, { status: 500 });
  }
}

// POST /api/admin/refunds - Process a refund manually
export async function POST(request: NextRequest) {
    const admin = await requireAdminApi();
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  try {
    const body = await request.json();
    const { orderId, reason } = body;

    if (!orderId) {
      return NextResponse.json({ error: "Order ID required" }, { status: 400 });
    }

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (order.refundedAt) {
      return NextResponse.json({ error: "Order already refunded" }, { status: 400 });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, order.userId),
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Process refund
    await db.transaction(async (tx) => {
      const newBalance = user.walletBalance + order.amount;

      // Credit user wallet
      await tx
        .update(users)
        .set({ walletBalance: newBalance })
        .where(eq(users.id, user.id));

      // Mark order as refunded
      await tx
        .update(orders)
        .set({ refundedAt: new Date(), status: "refunded" })
        .where(eq(orders.id, orderId));

      // Record transaction
      const reference = `REFUND-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

      await tx.insert(walletTransactions).values({
        userId: user.id,
        orderId: order.id,
        type: "credit",
        amount: order.amount,
        balanceAfter: newBalance,
        description: reason || `Refund for order ${order.reference}`,
        reference,
      });
    });

    logger.info("Manual refund processed", { orderId, amount: order.amount });

    return NextResponse.json({
      ok: true,
      message: "Refund processed successfully",
      refundAmount: order.amount,
    });
  } catch (error) {
    logger.error("Failed to process refund", { error });
    return NextResponse.json({ error: "Failed to process refund" }, { status: 500 });
  }
}
