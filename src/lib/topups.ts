import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { paymentTopups, users, walletTransactions } from "@/db/schema";
import { scheduleWalletEmails } from "@/lib/schedule-wallet-emails";

export type TopUpOutcome = "credited" | "duplicate" | "mismatch";

/**
 * Complete a wallet top-up exactly once.
 *
 * The single place money enters a wallet. Both the Paystack webhook and the
 * browser-callback verification call it, so there is no second, divergent
 * credit path — a payment confirmed twice (or retried by Paystack) credits once.
 *
 * The conditional update (`… WHERE status = 'pending'`) serializes concurrent
 * deliveries: only the first transition wins, and the status change, the balance
 * credit and the ledger row commit or roll back together.
 */
export async function completeTopUp(input: {
  reference: string;
  userId: string;
  amount: number;
}): Promise<TopUpOutcome> {
  const { reference, userId, amount } = input;

  const outcome = await db.transaction(async (tx) => {
    const [topup] = await tx
      .update(paymentTopups)
      .set({ status: "completed", paidAt: new Date() })
      .where(
        and(
          eq(paymentTopups.reference, reference),
          eq(paymentTopups.userId, userId),
          eq(paymentTopups.amount, amount),
          eq(paymentTopups.status, "pending"),
        ),
      )
      .returning();

    if (!topup) {
      const [previous] = await tx
        .select()
        .from(paymentTopups)
        .where(eq(paymentTopups.reference, reference))
        .limit(1);

      if (previous?.status === "completed" && previous.userId === userId && previous.amount === amount) {
        return "duplicate" as const;
      }

      return "mismatch" as const;
    }

    const [updatedUser] = await tx
      .update(users)
      .set({ walletBalance: sql`${users.walletBalance} + ${amount}` })
      .where(eq(users.id, userId))
      .returning({ balance: users.walletBalance });

    if (!updatedUser) throw new Error("Top-up user not found");

    await tx.insert(walletTransactions).values({
      userId,
      type: "credit",
      amount,
      balanceAfter: updatedUser.balance,
      description: "Paystack wallet top-up",
      reference,
    });

    return "credited" as const;
  });
  // Also drain on a duplicate callback: a previous response may have been lost
  // after the ledger and its outbox row committed.
  if (outcome !== "mismatch") scheduleWalletEmails();
  return outcome;
}
