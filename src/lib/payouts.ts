import "server-only";
import { and, eq, isNotNull, lt } from "drizzle-orm";

import { db } from "@/db";
import { withdrawals } from "@/db/schema";
import { logger } from "@/lib/logger";
import { initiateTransfer, isPaystackConfigured, verifyTransfer } from "@/lib/paystack";
import { settleTransferEvent } from "@/lib/paystack-transfer-settlement";
import { refundWithdrawal } from "@/lib/withdrawal-refund";

type Withdrawal = typeof withdrawals.$inferSelect;

/**
 * Sending a payout the moment it is asked for.
 *
 * The customer used to wait for an operator: request, queue, approve, then the
 * transfer. That does not survive a thousand requests — the queue *is* the
 * product failure, and every hour in it is an hour somebody's money is missing
 * with no reason they can see.
 *
 * ## The four things that can happen, and why they are four
 *
 * 1. **The provider accepted it.** The row stays `processing` with the transfer
 *    code stored; a signed `transfer.success` (or the reconciliation sweep, if
 *    that event never arrives) completes it. Money has genuinely left.
 * 2. **The provider refused it.** Paystack answered `status: false` with a
 *    reason — insufficient provider balance, a blocked recipient, an invalid
 *    account. Nothing left, so the wallet is refunded immediately with a ledger
 *    row and the customer is told why. The row is `failed`.
 * 3. **We do not know.** A timeout, a 5xx, or a response we cannot check against
 *    our own record. This is the case that must never be guessed: a refund here
 *    could pay twice, so the row stays `processing` with a note, the wallet stays
 *    debited, and the reconciliation sweep asks the provider what happened.
 * 4. **The provider wants a human** (`otp`, Paystack's merchant authorization).
 *    Also unconfirmed, never refunded — that transfer can still be completed from
 *    the Paystack dashboard, so refunding it would be paying the customer twice.
 *
 * `unconfirmed` is therefore a deliberate dead end for the automatic path, not an
 * oversight: it is the only honest answer when the alternative is inventing one.
 */

export type PayoutOutcome =
  | { outcome: "sent"; transferCode: string; providerStatus: string }
  | { outcome: "settled"; transferCode: string }
  | { outcome: "refunded"; reason: string; refunded: number }
  | { outcome: "unconfirmed"; reason: string };

const ACCEPTED_STATUSES = ["pending", "processing", "queued"];

function refusalReason(message: unknown): string {
  const text = typeof message === "string" ? message.replace(/[\r\n\t]+/g, " ").trim().slice(0, 200) : "";
  return (
    `The payment provider refused this payout${text ? ` (${text})` : ""}. ` +
    "The amount and fee were returned to your wallet."
  ).slice(0, 1_000);
}

/**
 * Send one withdrawal's money, given a row that is already `processing` and
 * carries its provider reference and recipient code.
 */
export async function sendPayout(withdrawal: Withdrawal): Promise<PayoutOutcome> {
  if (!isPaystackConfigured()) {
    return { outcome: "unconfirmed", reason: "The payment provider is not configured." };
  }
  if (!withdrawal.paystackReference || !withdrawal.recipientCode) {
    return { outcome: "unconfirmed", reason: "The withdrawal has no provider reference or recipient." };
  }

  let transfer: Awaited<ReturnType<typeof initiateTransfer>>;
  try {
    transfer = await initiateTransfer({
      source: "balance",
      amount: withdrawal.amount * 100,
      currency: "NGN",
      recipient: withdrawal.recipientCode,
      reason: `Withdrawal ${withdrawal.reference}`,
      reference: withdrawal.paystackReference,
    });
  } catch (error) {
    // A timeout or a 5xx can arrive after Paystack accepted the transfer. The
    // row stays in flight and the sweep asks again; refunding here is the one
    // mistake that pays twice.
    logger.error("Payout initiation outcome unknown", {
      withdrawalId: withdrawal.id,
      reference: withdrawal.reference,
      error: error instanceof Error ? error.message : String(error),
    });
    return { outcome: "unconfirmed", reason: "The provider did not confirm the transfer." };
  }

  // A clean `status: false` is a refusal: Paystack answered, and the answer was
  // no. Anything structural we cannot verify against our own row is treated as
  // "unknown" instead, because a transfer may exist that we failed to read.
  if (transfer?.status !== true) {
    const reason = refusalReason(transfer?.message);
    const refund = await refundWithdrawal({
      withdrawalId: withdrawal.id,
      from: ["processing"],
      to: "failed",
      note: reason,
    });
    if (!refund) {
      return { outcome: "unconfirmed", reason: "The payout could not be sent, and its row had already changed." };
    }
    logger.warn("Payout refused by the provider and refunded", {
      withdrawalId: withdrawal.id,
      reference: withdrawal.reference,
      amount: refund.amount,
    });
    return { outcome: "refunded", reason, refunded: refund.amount };
  }

  const data = transfer.data;
  const transferCode = typeof data?.transfer_code === "string" ? data.transfer_code.trim() : "";
  if (!transferCode || transferCode.length > 100 ||
      data.reference !== withdrawal.paystackReference ||
      data.amount !== withdrawal.amount * 100 ||
      data.currency !== "NGN") {
    logger.error("Payout initiation could not be verified against the recorded withdrawal", {
      withdrawalId: withdrawal.id,
      reference: withdrawal.reference,
      providerReference: typeof data?.reference === "string" ? data.reference : null,
      providerAmount: typeof data?.amount === "number" ? data.amount : null,
      providerCurrency: typeof data?.currency === "string" ? data.currency : null,
    });
    return { outcome: "unconfirmed", reason: "The provider's confirmation did not match the request." };
  }

  const providerStatus = typeof data.status === "string" && data.status.length <= 40 ? data.status : "unknown";

  if (providerStatus === "success") {
    // Rare at creation, but it happens on instant rails. The same guarded update
    // the webhook uses, so there is one definition of "settled".
    const settled = await settleTransferEvent({
      event: "transfer.success",
      reference: withdrawal.paystackReference,
      amountKobo: withdrawal.amount * 100,
      currency: "NGN",
      providerStatus,
      transferCode,
      reason: null,
    });
    if (settled === "settled" || settled === "already_settled") return { outcome: "settled", transferCode };
  }

  if (providerStatus === "failed" || providerStatus === "reversed") {
    const note =
      `The payment provider reported the transfer as ${providerStatus} at creation. ` +
      "The amount and fee were returned to your wallet.";
    const refund = await refundWithdrawal({
      withdrawalId: withdrawal.id,
      from: ["processing"],
      to: "failed",
      note,
    });
    if (refund) {
      logger.warn("Payout failed at the provider and was refunded", {
        withdrawalId: withdrawal.id,
        reference: withdrawal.reference,
        providerStatus,
      });
      return { outcome: "refunded", reason: note, refunded: refund.amount };
    }
  }

  const note = providerStatus === "otp"
    ? "The payment provider requires merchant authorization for this transfer. It has not been refunded; check the provider before resolving it."
    : ACCEPTED_STATUSES.includes(providerStatus)
      ? null
      : "The provider's transfer status is unconfirmed. Reconcile it before retrying or refunding.";

  await db
    .update(withdrawals)
    .set({ transferReference: transferCode, failureReason: note })
    .where(and(eq(withdrawals.id, withdrawal.id), eq(withdrawals.status, "processing")));

  logger.info("Payout initiated", { withdrawalId: withdrawal.id, reference: withdrawal.reference, providerStatus });
  return { outcome: "sent", transferCode, providerStatus };
}

/**
 * Ask the provider about payouts it has not reported on.
 *
 * The webhook is the fast path; this exists because a payout must not depend on a
 * message arriving. A transfer event that was never subscribed, an outage, a
 * merchant-OTP transfer that was authorised by hand — all of them end up here,
 * and each one is settled through the same guarded path a webhook uses, so the
 * two can never disagree about what "settled" means.
 *
 * Rows younger than `olderThanMinutes` are skipped: a payout that was sent four
 * seconds ago is simply not settled yet, and asking the provider about it creates
 * noise without information.
 */
export async function reconcileInFlightPayouts(options: { olderThanMinutes?: number; limit?: number } = {}) {
  const olderThanMinutes = options.olderThanMinutes ?? 10;
  const limit = options.limit ?? 20;
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);

  const rows = await db
    .select()
    .from(withdrawals)
    .where(and(
      eq(withdrawals.status, "processing"),
      isNotNull(withdrawals.paystackReference),
      lt(withdrawals.createdAt, cutoff),
    ))
    .limit(limit);

  const result = { checked: 0, settled: 0, refunded: 0, stillPending: 0, failed: 0 };

  for (const row of rows) {
    result.checked += 1;
    try {
      const verified = await verifyTransfer(row.paystackReference!);
      const data = verified?.data;
      const providerStatus = verified?.status === true && typeof data?.status === "string" ? data.status.toLowerCase() : "";
      if (!providerStatus) {
        result.failed += 1;
        continue;
      }

      if (providerStatus === "success" || providerStatus === "failed" || providerStatus === "reversed" || providerStatus === "abandoned") {
        const event = `transfer.${providerStatus}` as "transfer.success" | "transfer.failed" | "transfer.reversed" | "transfer.abandoned";
        const applied = await settleTransferEvent({
          event,
          reference: row.paystackReference!,
          // The provider is authoritative about this transfer, but our amount is
          // what the ledger was written with — a disagreement is reported by the
          // settlement path rather than silently applied.
          amountKobo: row.amount * 100,
          currency: "NGN",
          providerStatus,
          transferCode: typeof data?.transfer_code === "string" ? data.transfer_code : row.transferReference,
          reason: typeof (data as unknown as { reason?: unknown })?.reason === "string" ? (data as unknown as { reason: string }).reason : null,
        });
        if (applied === "settled" || applied === "already_settled") result.settled += 1;
        else if (applied === "refunded") result.refunded += 1;
        else result.stillPending += 1;
      } else {
        result.stillPending += 1;
      }
    } catch (error) {
      result.failed += 1;
      logger.warn("Payout reconciliation could not read one transfer", {
        withdrawalId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
