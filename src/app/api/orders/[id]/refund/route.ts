import { randomBytes } from "node:crypto";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, users, walletTransactions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/net";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { isPreviewSingleNumberWithoutCode, PREVIEW_SINGLE_NUMBER_WINDOW } from "@/lib/refund-policy";
import { SERVICE_TIMEOUTS } from "@/lib/service-timeouts";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Please sign in first." }, { status: 401 });
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, error: "Cross-origin request denied." }, { status: 403 });

  const { id } = await params;
  try {
    const [order] = await db.select().from(orders)
      .where(and(eq(orders.id, id), eq(orders.userId, user.id))).limit(1);
    if (!order) return Response.json({ ok: false, error: "We couldn't find that order." }, { status: 404 });
    if (order.status !== "active" || order.refundedAt) {
      return Response.json({ ok: false, error: "This order is already complete or refunded." }, { status: 409 });
    }

    // Provider cancellation/refund semantics have not been verified. Legacy
    // live orders require manual reconciliation instead of automatic credit.
    if (!isPreviewDatabase() || order.provider !== "simulated") {
      return Response.json({ ok: false, error: "Please contact support to reconcile this order." }, { status: 503 });
    }
    const cutoff = new Date(Date.now() - SERVICE_TIMEOUTS.numbers.delivery);
    const createdAt = new Date(order.createdAt).getTime();
    if (!isPreviewSingleNumberWithoutCode(order) || !Number.isFinite(createdAt) || createdAt > cutoff.getTime()) {
      return Response.json({ ok: false, error: "This simulated order is not eligible for an automatic refund." }, { status: 409 });
    }

    const balance = await db.transaction(async (tx) => {
      const [claimed] = await tx.update(orders)
        .set({ status: "refunded", refundedAt: new Date() })
        .where(and(
          eq(orders.id, id), eq(orders.userId, user.id), eq(orders.status, "active"),
          isNull(orders.refundedAt), eq(orders.provider, "simulated"), eq(orders.service, "numbers"),
          eq(orders.duration, PREVIEW_SINGLE_NUMBER_WINDOW), isNull(orders.otpCode), lte(orders.createdAt, cutoff),
        ))
        .returning();
      if (!claimed) return null;
      if (!Number.isSafeInteger(claimed.amount) || claimed.amount <= 0) throw new Error("Invalid order amount");

      const [updated] = await tx.update(users)
        .set({ walletBalance: sql`${users.walletBalance} + ${claimed.amount}` })
        .where(eq(users.id, user.id))
        .returning({ balance: users.walletBalance });
      if (!updated) throw new Error("Refund user not found");
      await tx.insert(walletTransactions).values({
        userId: user.id,
        amount: claimed.amount,
        type: "refund",
        description: `Auto-refund · ${claimed.productName}`.slice(0, 200),
        orderId: claimed.id,
        balanceAfter: updated.balance,
        reference: `RFD-${randomBytes(12).toString("hex")}`,
      });
      return updated.balance;
    });

    if (balance === null) return Response.json({ ok: false, error: "This order can no longer be refunded." }, { status: 409 });
    return Response.json({ ok: true, balance, providerCancelled: false });
  } catch {
    return Response.json({ ok: false, error: "The refund didn't go through. Please contact support." }, { status: 500 });
  }
}
