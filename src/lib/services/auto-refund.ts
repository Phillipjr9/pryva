import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, users, walletReservations, walletTransactions } from "@/db/schema";
import { cancelUpstream } from "@/lib/services/fulfillment";
import { flagReconciliation } from "@/lib/services/reconciliation";
import { deliveryWindowMs } from "@/lib/services/registry";
import { confirmNumberRefund } from "@/lib/services/numbers/refund-confirmation";
import { isUndeliveredSingleNumber, SINGLE_NUMBER_WINDOW } from "@/lib/services/refund-policy";

/**
 * Refund single-number orders that timed out without ever producing a code.
 *
 * The order claim, balance increment and ledger entry are one transaction, and
 * every eligibility condition is repeated inside the UPDATE rather than trusted
 * from the initial SELECT — a code arriving mid-sweep, or a concurrent manual
 * refund, must not let an order be credited twice.
 *
 * Upstream cancellation happens *after* the claim commits, never before. The
 * claim re-checks `otpCode IS NULL`, so cancelling first could release a number
 * that had just delivered. A failed cancel is logged and does not block the
 * refund: recovering our cost is our problem, the customer's money is theirs.
 */
export async function processAutoRefunds(): Promise<{ refunded: number; cancelled: number }> {
  const cutoff = new Date(Date.now() - deliveryWindowMs("numbers"));
  const eligible = and(
    inArray(orders.status, ["active", "expired"]),
    eq(orders.service, "numbers"),
    eq(orders.duration, SINGLE_NUMBER_WINDOW),
    isNull(orders.otpCode),
    isNull(orders.refundedAt),
    lte(orders.createdAt, cutoff),
  );
  const candidates = await db.select().from(orders).where(eligible)
    .orderBy(sql`${orders.refundCheckedAt} ASC NULLS FIRST`, orders.createdAt, orders.id).limit(100);
  // A review hold means the supplier may already have taken the money. Refunding
  // automatically there would pay the customer for a purchase we funded, so those
  // rows are left for a human even though their order status looks refundable.
  const reviewed = new Set(
    (await db.select({ orderId: walletReservations.orderId }).from(walletReservations)
      .where(eq(walletReservations.status, "review"))).map((row) => row.orderId),
  );
  let refunded = 0;
  let cancelled = 0;

  for (const candidate of candidates) {
    // Belt and braces: the SQL already encodes this, but a future edit to the
    // query should not silently widen what gets an automatic refund.
    if (!isUndeliveredSingleNumber(candidate)) continue;
    if (reviewed.has(candidate.id)) continue;

    try {
      // Mark before network I/O, so an unavailable or slow supplier cannot
      // permanently starve the rest of the queue. This does not claim/refund.
      const [stillEligible] = await db.update(orders).set({ refundCheckedAt: new Date() })
        .where(and(eq(orders.id, candidate.id), eligible)).returning({ id: orders.id });
      if (!stillEligible) continue;
      if (await confirmNumberRefund(candidate) !== "refundable") continue;
      const claimed = await db.transaction(async (tx) => {
        const [row] = await tx.update(orders)
          .set({ status: "refunded", refundedAt: new Date() })
          .where(and(eq(orders.id, candidate.id), eligible))
          .returning();
        if (!row) return null;
        if (!Number.isSafeInteger(row.amount) || row.amount <= 0) throw new Error("Invalid order amount");
        const [debit] = await tx.select({ id: walletTransactions.id }).from(walletTransactions).where(and(
          eq(walletTransactions.orderId, row.id), eq(walletTransactions.userId, row.userId),
          eq(walletTransactions.type, "debit"), eq(walletTransactions.amount, row.amount),
        )).limit(1);
        if (!debit) throw new Error("Matching order debit not found; refund requires review");

        const [user] = await tx.update(users)
          .set({ walletBalance: sql`${users.walletBalance} + ${row.amount}` })
          .where(eq(users.id, row.userId))
          .returning({ balance: users.walletBalance });
        if (!user) throw new Error("Refund user not found");

        await tx.insert(walletTransactions).values({
          userId: row.userId,
          orderId: row.id,
          type: "refund",
          amount: row.amount,
          balanceAfter: user.balance,
          description: `Auto-refund: ${row.productName} (no code)`.slice(0, 200),
          reference: `RFD-${randomBytes(12).toString("hex")}`,
        });
        return row;
      });

      if (!claimed) continue;
      refunded++;

      try {
        if (await cancelUpstream(claimed)) cancelled++;
        else await flagReconciliation(claimed.id);
      } catch (cancelError) {
        // The customer is already made whole. This is our cost to chase.
        console.error("Auto-refund succeeded but upstream cancel failed", {
          orderId: claimed.id,
          providerRequestId: claimed.providerRequestId,
          error: cancelError instanceof Error ? cancelError.message : String(cancelError),
        });
        // Persisted, not just logged: the customer is made whole and the unit may
        // still be live in their hands, so this has to reach a human.
        await flagReconciliation(claimed.id);
      }
    } catch (error) {
      console.error(`Failed to process refund for order ${candidate.id}:`, error);
    }
  }

  return { refunded, cancelled };
}
