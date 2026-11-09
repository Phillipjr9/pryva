import { isVercelPreview } from "@/lib/platform/financial-environment";
import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, users, walletTransactions } from "@/db/schema";
import { getCurrentUser } from "@/lib/identity/auth";
import { isSameOriginMutation } from "@/lib/platform/net";
import { refundRateLimiter } from "@/lib/platform/rate-limit";
import { cancelUpstream } from "@/lib/services/fulfillment";
import { flagReconciliation } from "@/lib/services/reconciliation";
import { isUndeliveredSingleNumber, SINGLE_NUMBER_WINDOW } from "@/lib/services/refund-policy";
import { confirmNumberRefund } from "@/lib/services/numbers/refund-confirmation";
import { deliveryWindowMs } from "@/lib/services/registry";

export const dynamic = "force-dynamic";

/**
 * POST /api/orders/:id/refund
 *
 * Self-service refund for a single-verification number order that timed out
 * without producing a code. Eligibility is provider-agnostic: if we took the
 * money and nothing was delivered within the window, the customer gets it back
 * without having to talk to us first.
 *
 * The claim repeats every eligibility condition inside the UPDATE so a code
 * landing mid-request — or a concurrent sweep — cannot credit the order twice.
 * Upstream cancellation runs only after the claim commits, for the same reason:
 * cancel first and we could release a number that had just delivered.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Please sign in first." }, { status: 401 });
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, error: "Cross-origin request denied." }, { status: 403 });
  if (isVercelPreview()) return Response.json({ ok: false, error: "Refunds are unavailable in preview" }, { status: 503 });

  // Before any order lookup: a refund triggers a provider call and a wallet
  // credit, so the throttle has to sit ahead of the work it protects.
  const refundLimit = await refundRateLimiter(`refund:${user.id}`);
  if (refundLimit.unavailable) {
    return Response.json({ ok: false, error: "Refunds are temporarily unavailable. Try again shortly." }, { status: 503 });
  }
  if (!refundLimit.allowed) {
    return Response.json({ ok: false, error: "Too many refund attempts. Try again later." }, { status: 429 });
  }

  const { id } = await params;
  try {
    const [order] = await db.select().from(orders)
      .where(and(eq(orders.id, id), eq(orders.userId, user.id))).limit(1);
    if (!order) return Response.json({ ok: false, error: "We couldn't find that order." }, { status: 404 });
    if (!["active", "expired"].includes(order.status) || order.refundedAt) {
      return Response.json({ ok: false, error: "This order is already complete or refunded." }, { status: 409 });
    }

    const cutoff = new Date(Date.now() - deliveryWindowMs("numbers"));
    const createdAt = new Date(order.createdAt).getTime();
    if (!isUndeliveredSingleNumber(order) || !Number.isFinite(createdAt) || createdAt > cutoff.getTime()) {
      // Rentals land here too: no upstream cancel exists for them, so a human
      // has to weigh time already used against the price paid.
      return Response.json({
        ok: false,
        error: "This order isn't eligible for an automatic refund. Contact support with your reference and we'll review it.",
      }, { status: 409 });
    }

    const confirmation = await confirmNumberRefund(order);
    if (confirmation === "delivered") {
      return Response.json({ ok: false, error: "A code was received for this order. Check your order details." }, { status: 409 });
    }
    if (confirmation !== "refundable") {
      return Response.json({ ok: false, error: "Delivery could not yet be confirmed. Contact support with your reference; no refund has been issued." }, { status: 409 });
    }

    const claimed = await db.transaction(async (tx) => {
      const [row] = await tx.update(orders)
        .set({ status: "refunded", refundedAt: new Date() })
        .where(and(
          eq(orders.id, id), eq(orders.userId, user.id), inArray(orders.status, ["active", "expired"]),
          isNull(orders.refundedAt), eq(orders.service, "numbers"),
          eq(orders.duration, SINGLE_NUMBER_WINDOW), isNull(orders.otpCode), lte(orders.createdAt, cutoff),
        ))
        .returning();
      if (!row) return null;
      if (!Number.isSafeInteger(row.amount) || row.amount <= 0) throw new Error("Invalid order amount");
      const [debit] = await tx.select({ id: walletTransactions.id }).from(walletTransactions).where(and(
        eq(walletTransactions.orderId, row.id), eq(walletTransactions.userId, row.userId),
        eq(walletTransactions.type, "debit"), eq(walletTransactions.amount, row.amount),
      )).limit(1);
      if (!debit) throw new Error("Matching order debit not found; refund requires review");

      const [updated] = await tx.update(users)
        .set({ walletBalance: sql`${users.walletBalance} + ${row.amount}` })
        .where(eq(users.id, user.id))
        .returning({ balance: users.walletBalance });
      if (!updated) throw new Error("Refund user not found");
      await tx.insert(walletTransactions).values({
        userId: user.id,
        amount: row.amount,
        type: "refund",
        description: `Auto-refund · ${row.productName}`.slice(0, 200),
        orderId: row.id,
        balanceAfter: updated.balance,
        reference: `RFD-${randomBytes(12).toString("hex")}`,
      });
      return { row, balance: updated.balance };
    });

    if (claimed === null) {
      return Response.json({ ok: false, error: "This order can no longer be refunded." }, { status: 409 });
    }

    // Best-effort: the refund already succeeded, so a failed cancel is our cost
    // to reconcile, never a reason to withhold the customer's money.
    let providerCancelled = false;
    try {
      providerCancelled = await cancelUpstream(claimed.row);
      if (!providerCancelled) await flagReconciliation(claimed.row.id);
    } catch (cancelError) {
      console.error("Refund succeeded but upstream cancel failed", {
        orderId: claimed.row.id,
        providerRequestId: claimed.row.providerRequestId,
        error: cancelError instanceof Error ? cancelError.message : String(cancelError),
      });
      await flagReconciliation(claimed.row.id);
    }

    return Response.json({ ok: true, balance: claimed.balance, providerCancelled });
  } catch {
    return Response.json({ ok: false, error: "The refund didn't go through. Please contact support." }, { status: 500 });
  }
}
