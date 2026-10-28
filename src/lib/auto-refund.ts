import { randomBytes } from "node:crypto";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, users, walletTransactions } from "@/db/schema";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { SERVICE_TIMEOUTS } from "@/lib/service-timeouts";
import { PREVIEW_SINGLE_NUMBER_WINDOW } from "@/lib/refund-policy";

/**
 * Refund timed-out, code-less *simulated* single-number orders only.
 *
 * Live provider cancellation and delivery semantics are not verified. Never use
 * this sweep for a persistent database: those orders need manual reconciliation.
 * The order claim, balance increment and ledger entry are one transaction so a
 * concurrent sweep or manual refund cannot credit an order twice.
 */
export async function processAutoRefunds(): Promise<number> {
  if (!isPreviewDatabase()) {
    throw new Error("Live automatic refunds require provider reconciliation");
  }

  const cutoff = new Date(Date.now() - SERVICE_TIMEOUTS.numbers.delivery);
  const eligible = and(
    eq(orders.status, "active"),
    eq(orders.provider, "simulated"),
    eq(orders.service, "numbers"),
    eq(orders.duration, PREVIEW_SINGLE_NUMBER_WINDOW),
    isNull(orders.otpCode),
    isNull(orders.refundedAt),
    lte(orders.createdAt, cutoff),
  );
  const candidates = await db.select().from(orders).where(eligible).limit(100);
  let refunded = 0;

  for (const candidate of candidates) {
    try {
      const credited = await db.transaction(async (tx) => {
        // Repeat every eligibility condition in the UPDATE, not just the
        // initial SELECT: delivery or another refund may have won the race.
        const [claimed] = await tx.update(orders)
          .set({ status: "refunded", refundedAt: new Date() })
          .where(and(eq(orders.id, candidate.id), eligible))
          .returning();
        if (!claimed) return false;
        if (!Number.isSafeInteger(claimed.amount) || claimed.amount <= 0) {
          throw new Error("Invalid order amount");
        }

        const [user] = await tx.update(users)
          .set({ walletBalance: sql`${users.walletBalance} + ${claimed.amount}` })
          .where(eq(users.id, claimed.userId))
          .returning({ balance: users.walletBalance });
        if (!user) throw new Error("Refund user not found");

        await tx.insert(walletTransactions).values({
          userId: claimed.userId,
          orderId: claimed.id,
          type: "refund",
          amount: claimed.amount,
          balanceAfter: user.balance,
          description: `Auto-refund: ${claimed.productName} (no code)`.slice(0, 200),
          reference: `RFD-${randomBytes(12).toString("hex")}`,
        });
        return true;
      });
      if (credited) refunded++;
    } catch (error) {
      console.error(`Failed to process refund for order ${candidate.id}:`, error);
    }
  }

  return refunded;
}
