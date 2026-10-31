import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { users, walletTransactions, withdrawals } from "@/db/schema";
import { logger } from "@/lib/logger";

type Withdrawal = typeof withdrawals.$inferSelect;

/**
 * Give back exactly what a payout took: the amount **and** the fee.
 *
 * A withdrawal request debits `amount + fee` in one ledger row, so a payout that
 * does not happen has to return that same figure — refunding only the amount
 * would quietly keep the fee for a transfer nobody received.
 *
 * ## Why this is one function and not four
 *
 * Three paths can end a payout — the provider refusing it outright, a webhook
 * saying it failed, and an operator rejecting a request — and every one of them
 * has to do the same three things together or none of them: change the status,
 * credit the wallet and write the ledger row. Written separately they drift, and
 * the drift is invisible until a balance does not reconcile. The status is part
 * of the `UPDATE ... WHERE`, so whichever path gets there first wins and every
 * later attempt is a no-op rather than a second refund.
 *
 * Returns the refunded amount, or `null` when the row was not in one of the
 * states this call is allowed to end — the caller decides what to tell the
 * customer in that case.
 */
export async function refundWithdrawal(params: {
  withdrawalId: string;
  /** The states this particular caller may end. */
  from: string[];
  /** Final status. `failed` for a payout, `rejected` for an operator's refusal. */
  to: "failed" | "rejected";
  /** Operator- or provider-readable note stored on the row. */
  note: string;
}): Promise<{ amount: number; balanceAfter: number } | null> {
  const refunded = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(withdrawals)
      .set({ status: params.to, processedAt: new Date(), failureReason: params.note })
      .where(and(eq(withdrawals.id, params.withdrawalId), inArray(withdrawals.status, params.from)))
      .returning();
    if (!claimed) return null;

    const amount = claimed.amount + claimed.fee;
    const [user] = await tx
      .update(users)
      .set({ walletBalance: sql`${users.walletBalance} + ${amount}` })
      .where(eq(users.id, claimed.userId))
      .returning({ balance: users.walletBalance });
    if (!user) throw new Error("Withdrawal user not found");

    await tx.insert(walletTransactions).values({
      userId: claimed.userId,
      type: "refund",
      amount,
      balanceAfter: user.balance,
      description: `Refund for ${params.to === "rejected" ? "rejected" : "failed"} withdrawal ${claimed.reference}`,
      reference: `RWD-${randomBytes(12).toString("hex")}`,
    });

    return { amount, balanceAfter: user.balance, withdrawal: claimed as Withdrawal };
  });

  if (!refunded) return null;
  logger.info("Withdrawal refunded", {
    withdrawalId: refunded.withdrawal.id,
    reference: refunded.withdrawal.reference,
    status: params.to,
    amount: refunded.amount,
  });
  return { amount: refunded.amount, balanceAfter: refunded.balanceAfter };
}
