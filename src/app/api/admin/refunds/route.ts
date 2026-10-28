import { randomBytes } from "node:crypto";
import { authorizeAdminApi } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders, users, walletTransactions } from "@/db/schema";
import { eq, and, isNull, ne, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { scheduleWalletEmails } from "@/lib/schedule-wallet-emails";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const dynamic = "force-dynamic";

// GET /api/admin/refunds - List orders eligible for refund or with pending refunds
export async function GET(request: NextRequest) {
  try {
    const access = await authorizeAdminApi(request);
    if (access.response) return access.response;

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
  try {
    const access = await authorizeAdminApi(request);
    if (access.response) return access.response;

    if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 2_048);
    } catch (error) {
      return NextResponse.json({ error: "Invalid request body" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    const { orderId, reason, reconciliationConfirmed } = body as { orderId?: unknown; reason?: unknown; reconciliationConfirmed?: unknown };
    if (typeof orderId !== "string" || !/^[a-z0-9-]{1,64}$/i.test(orderId)) {
      return NextResponse.json({ error: "Order ID required" }, { status: 400 });
    }
    if (reason !== undefined && (typeof reason !== "string" || reason.length > 180)) {
      return NextResponse.json({ error: "Invalid reason" }, { status: 400 });
    }
    if (reconciliationConfirmed === true && (typeof reason !== "string" || !reason.trim())) {
      return NextResponse.json({ error: "A reconciliation reason is required" }, { status: 400 });
    }

    const result = await db.transaction(async (tx) => {
      const [order] = await tx.update(orders)
        .set({ refundedAt: new Date(), status: "refunded" })
        // A supplier request may still be in flight. Only reconcile/refund it
        // after it has left processing and its provider outcome is verified.
        .where(and(
          eq(orders.id, orderId), isNull(orders.refundedAt),
          ne(orders.status, "refunded"), ne(orders.status, "processing"),
          reconciliationConfirmed === true ? undefined : ne(orders.status, "review"),
        ))
        .returning();
      if (!order) return null;
      if (!Number.isSafeInteger(order.amount) || order.amount <= 0) throw new Error("Invalid order amount");

      const [user] = await tx.update(users)
        .set({ walletBalance: sql`${users.walletBalance} + ${order.amount}` })
        .where(eq(users.id, order.userId))
        .returning({ balance: users.walletBalance });
      if (!user) throw new Error("Refund user not found");

      await tx.insert(walletTransactions).values({
        userId: order.userId,
        orderId: order.id,
        type: "refund",
        amount: order.amount,
        balanceAfter: user.balance,
        description: typeof reason === "string" && reason.trim() ? reason.trim() : `Refund for order ${order.reference}`,
        reference: `REF-${randomBytes(12).toString("hex")}`,
      });
      return order;
    });

    if (!result) {
      return NextResponse.json({ error: "Order not found, already refunded, still processing, or requires confirmed reconciliation" }, { status: 409 });
    }
    logger.info("Manual refund processed", { orderId, amount: result.amount, adminId: access.user.id });
    scheduleWalletEmails();
    return NextResponse.json({ ok: true, message: "Refund processed successfully", refundAmount: result.amount });
  } catch (error) {
    logger.error("Failed to process refund", { error });
    return NextResponse.json({ error: "Failed to process refund" }, { status: 500 });
  }
}
