import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, users, walletTransactions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/net";

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
    if (order.provider !== "simulated") {
      return Response.json({ ok: false, error: "Please contact support to reconcile this live order." }, { status: 503 });
    }

    const balance = await db.transaction(async (tx) => {
      const [claimed] = await tx.update(orders)
        .set({ status: "refunded", refundedAt: new Date() })
        .where(and(eq(orders.id, id), eq(orders.userId, user.id), eq(orders.status, "active"), isNull(orders.refundedAt)))
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
