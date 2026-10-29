import { randomBytes } from "node:crypto";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, users, walletTransactions } from "@/db/schema";
import { cancelUpstream } from "@/lib/fulfillment";
import { SERVICE_TIMEOUTS } from "@/lib/service-timeouts";
import { isUndeliveredSingleNumber, SINGLE_NUMBER_WINDOW } from "@/lib/refund-policy";

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
  const cutoff = new Date(Date.now() - SERVICE_TIMEOUTS.numbers.delivery);
  const eligible = and(
    eq(orders.status, "active"),
    eq(orders.service, "numbers"),
    eq(orders.duration, SINGLE_NUMBER_WINDOW),
    isNull(orders.otpCode),
    isNull(orders.refundedAt),
    lte(orders.createdAt, cutoff),
  );
  const candidates = await db.select().from(orders).where(eligible).limit(100);
  let refunded = 0;
  let cancelled = 0;

  for (const candidate of candidates) {
    // Belt and braces: the SQL already encodes this, but a future edit to the
    // query should not silently widen what gets an automatic refund.
    if (!isUndeliveredSingleNumber(candidate)) continue;

    try {
      const claimed = await db.transaction(async (tx) => {
        const [row] = await tx.update(orders)
          .set({ status: "refunded", refundedAt: new Date() })
          .where(and(eq(orders.id, candidate.id), eligible))
          .returning();
        if (!row) return null;
        if (!Number.isSafeInteger(row.amount) || row.amount <= 0) {
          throw new Error("Invalid order amount");
        }

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
      } catch (cancelError) {
        // The customer is already made whole. This is our cost to chase.
        console.error("Auto-refund succeeded but upstream cancel failed", {
          orderId: claimed.id,
          providerRequestId: claimed.providerRequestId,
          error: cancelError instanceof Error ? cancelError.message : String(cancelError),
        });
      }
    } catch (error) {
      console.error(`Failed to process refund for order ${candidate.id}:`, error);
    }
  }

  return { refunded, cancelled };
}
