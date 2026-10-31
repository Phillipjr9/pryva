import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { users, walletTransactions, withdrawals } from "@/db/schema";
import { logger } from "@/lib/logger";
import { scheduleWalletEmails } from "@/lib/schedule-wallet-emails";

/**
 * Settling a payout from the provider's own word.
 *
 * Until this existed a withdrawal could only reach `completed` when an operator
 * clicked "complete" in `/admin/withdrawals`, and every provider event other than
 * `charge.success` was answered `ok` and dropped. That meant Paystack could pay
 * the customer, send `transfer.success`, and the row would still read `processing`
 * — the customer sees "pending" forever, and an operator following the queue has
 * no way to tell "not paid yet" from "paid and the event was ignored". The same
 * gap in the other direction is worse: `transfer.failed`/`transfer.reversed` also
 * left the wallet debited, so a payout that never landed took the customer's money
 * silently.
 *
 * ## Why a failure refunds, and a success only marks the row
 *
 * `success` moves money out of our balance that the customer already paid for in
 * the wallet: nothing is refunded, and the guard is that the row must still be
 * `processing`, so a replayed event cannot complete it twice.
 *
 * `failed` / `reversed` / `abandoned` mean the naira did not stay with the
 * customer. The wallet was debited `amount + fee` when the request was created, so
 * the refund restores exactly that, in the same transaction that changes the
 * status — one row update, one wallet credit, one ledger entry, or none of them.
 * A replayed event finds the row already `failed` and refunds nothing, which is
 * the property that makes a twice-delivered webhook harmless.
 *
 * ## What this module will not do
 *
 * It will not touch a `pending` row (no transfer was ever initiated, so a
 * provider event about it is somebody else's reference), it will not act when the
 * amount or currency disagrees with what we recorded, and it does not decide that
 * a payout succeeded from anything but a signed event the route has already
 * verified. Ambiguity is left to a person, and logged.
 */

/** The provider events that describe a payout's fate. */
export const TRANSFER_EVENTS = [
  "transfer.success",
  "transfer.failed",
  "transfer.reversed",
  "transfer.abandoned",
] as const;

export type TransferEvent = (typeof TRANSFER_EVENTS)[number];

export function isTransferEvent(event: string): event is TransferEvent {
  return (TRANSFER_EVENTS as readonly string[]).includes(event);
}

export type TransferOutcome =
  /** The provider says the money reached the customer; the row is now completed. */
  | "settled"
  /** Already completed before this event arrived — nothing moved. */
  | "already_settled"
  /** The provider says the money did not stay; wallet refunded. */
  | "refunded"
  /** Already failed (or rejected) before this event arrived — nothing moved. */
  | "already_failed"
  /** The row is not in a state a provider event may change. Left for a person. */
  | "held"
  /** No withdrawal carries this provider reference. */
  | "unknown_reference"
  /** The event disagrees with what we recorded (amount or currency). */
  | "mismatch";

export interface TransferEventInput {
  event: TransferEvent;
  /** The reference we sent to the provider — `withdrawals.paystack_reference`. */
  reference: string;
  /** Integer kobo, as the provider reports it. */
  amountKobo: number;
  currency: string;
  /** The provider's own status string for the transfer, recorded verbatim-ish. */
  providerStatus: string;
  transferCode: string | null;
  /** The provider's stated reason for a failure, if it gave one. */
  reason: string | null;
}

const MAX_NOTE = 1_000;

/** One line an operator can act on, with no customer-facing secrets in it. */
function failureNote(input: TransferEventInput): string {
  const reason = input.reason
    ? input.reason.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)
    : "";
  const status = input.providerStatus.slice(0, 32);
  return (
    `The payment provider reported this transfer as ${status || "failed"}` +
    (reason ? ` (${reason})` : "") +
    ". The amount and fee were refunded to the wallet; this payout did not settle."
  ).slice(0, MAX_NOTE);
}

/**
 * Apply one signed provider event to the withdrawal it names.
 *
 * Never throws for an ordinary mismatch — the caller shapes the response — but a
 * database failure is allowed to surface, because the route answers 500 and asks
 * the provider to retry rather than acknowledging an event it did not apply.
 */
export async function settleTransferEvent(input: TransferEventInput): Promise<TransferOutcome> {
  const [row] = await db
    .select()
    .from(withdrawals)
    .where(eq(withdrawals.paystackReference, input.reference))
    .limit(1);

  if (!row) {
    logger.error("Provider reported a transfer we have no withdrawal for", {
      reference: input.reference,
      event: input.event,
      providerStatus: input.providerStatus,
      transferCode: input.transferCode,
    });
    return "unknown_reference";
  }

  const expectedKobo = row.amount * 100;
  if (input.currency !== "NGN" || input.amountKobo !== expectedKobo) {
    // Recorded as an error rather than a warning: an amount or currency that does
    // not match our own row is either a provider incident or a forged body that
    // somehow carried a valid signature. Neither should pass quietly.
    logger.error("Provider transfer event does not match the recorded withdrawal", {
      withdrawalId: row.id,
      reference: row.reference,
      event: input.event,
      expectedKobo,
      receivedKobo: input.amountKobo,
      currency: input.currency,
    });
    return "mismatch";
  }

  if (input.event === "transfer.success") {
    const [settled] = await db
      .update(withdrawals)
      .set({
        status: "completed",
        completedAt: new Date(),
        transferReference: input.transferCode ?? row.transferReference,
        failureReason: null,
      })
      // Only a row we believe is still in flight may be completed: this is the
      // guard that makes a twice-delivered event a no-op instead of a second
      // "paid" against the same money.
      .where(and(eq(withdrawals.id, row.id), eq(withdrawals.status, "processing")))
      .returning({ id: withdrawals.id });

    if (settled) {
      logger.info("Withdrawal settled by provider event", {
        withdrawalId: row.id,
        reference: row.reference,
        transferCode: input.transferCode,
      });
      scheduleWalletEmails();
      return "settled";
    }

    const [current] = await db
      .select({ status: withdrawals.status })
      .from(withdrawals)
      .where(eq(withdrawals.id, row.id))
      .limit(1);
    logger.info("Provider reported success for a withdrawal that was not in flight", {
      withdrawalId: row.id,
      reference: row.reference,
      status: current?.status ?? "missing",
    });
    return current?.status === "completed" ? "already_settled" : "held";
  }

  const refundAmount = row.amount + row.fee;
  const note = failureNote(input);
  // A bank can reverse a payout days after it looked settled, so a `reversed`
  // event may end a `completed` row. A plain `failed`/`abandoned` may not: it
  // cannot meaningfully follow a success, and if one arrives anyway a person has
  // to look at it rather than have the wallet credited on a contradiction.
  const mayEnd: string[] = input.event === "transfer.reversed" ? ["processing", "completed"] : ["processing"];

  const refunded = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(withdrawals)
      .set({ status: "failed", processedAt: new Date(), failureReason: note })
      .where(and(eq(withdrawals.id, row.id), inArray(withdrawals.status, mayEnd)))
      .returning();
    if (!claimed) return null;

    const [user] = await tx
      .update(users)
      .set({ walletBalance: sql`${users.walletBalance} + ${refundAmount}` })
      .where(eq(users.id, claimed.userId))
      .returning({ balance: users.walletBalance });
    if (!user) throw new Error("Withdrawal user not found");

    await tx.insert(walletTransactions).values({
      userId: claimed.userId,
      type: "refund",
      amount: refundAmount,
      balanceAfter: user.balance,
      description: `Refund for ${input.providerStatus || "failed"} withdrawal ${claimed.reference}`,
      reference: `RWD-${randomBytes(12).toString("hex")}`,
    });

    return claimed;
  });

  if (refunded) {
    logger.warn("Withdrawal failed at the provider and was refunded", {
      withdrawalId: refunded.id,
      reference: refunded.reference,
      event: input.event,
      providerStatus: input.providerStatus,
      refunded: refundAmount,
    });
    scheduleWalletEmails();
    return "refunded";
  }

  const [current] = await db
    .select({ status: withdrawals.status })
    .from(withdrawals)
    .where(eq(withdrawals.id, row.id))
    .limit(1);
  logger.info("Provider reported a failed transfer for a withdrawal that had already ended", {
    withdrawalId: row.id,
    reference: row.reference,
    status: current?.status ?? "missing",
    event: input.event,
  });
  return current?.status === "failed" || current?.status === "rejected" ? "already_failed" : "held";
}
