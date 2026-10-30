import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { paymentTopups, walletTransactions } from "@/db/schema";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { logger } from "@/lib/logger";
import { isPaystackConfigured, verifyPayment } from "@/lib/paystack";
import { completeTopUp } from "@/lib/topups";

/**
 * Ask Paystack what actually happened to one top-up, and credit it if the money
 * really arrived.
 *
 * ## Why this is a module and not two copies
 *
 * Two callers need this: the browser-return verification route (a customer
 * lands back from the checkout and the app confirms the charge) and the support
 * assistant (a customer says "I paid and my wallet was not credited"). Those two
 * must not grow different opinions about what counts as a confirmed payment. The
 * checks below are the whole of that opinion, in one place:
 *
 *   * the reference must belong to the account asking;
 *   * the payer's email at Paystack must be the account's email;
 *   * currency must be NGN;
 *   * the amount must match the stored top-up, compared on the *requested* net
 *     (Paystack grosses the figure up when "pass fees to customers" is on);
 *   * a charge must never be short of what was asked for;
 *   * a non-success status is unconfirmed, not a failure, except the two the
 *     provider states plainly (`failed`, `reversed`), and those are never a
 *     licence to try the payment again.
 *
 * Crediting goes through `completeTopUp`, the single idempotent path the webhook
 * uses, so a webhook that lands a second later credits nothing extra. Every
 * refusal below leaves the wallet untouched.
 *
 * ## What this deliberately does not do
 *
 * It never initialises a new payment and never re-charges anyone. It reads one
 * reference and either credits what is already owed or reports the state. A
 * "pending" answer is not a retry instruction, and the customer-facing text says
 * so.
 */

export type TopUpReconciliation =
  /** The charge is confirmed and the ledger row exists. `duplicate` means the money was already there. */
  | { outcome: "credited"; amount: number; balanceAfter: number; creditedAt: Date; duplicate: boolean }
  /** Not confirmed and not failed: ongoing, pending, processing, queued, abandoned, unknown. */
  | { outcome: "pending"; providerStatus: string; amount: number }
  /** Paystack says the charge failed or was reversed. Do not pay this reference again. */
  | { outcome: "failed"; providerStatus: string; amount: number }
  /** Paystack is not configured in this environment. */
  | { outcome: "not_configured" }
  /** No such top-up, or it belongs to another account. The two are deliberately indistinguishable. */
  | { outcome: "not_found" }
  /** Paystack says the payer is somebody else. */
  | { outcome: "wrong_customer" }
  /** Confirmed by the provider but the details disagree with what we recorded. Never credited. */
  | { outcome: "mismatch"; details: string[] }
  /** Already credited, but the provider now reports a different status: a person has to look. */
  | { outcome: "credited_status_conflict"; providerStatus: string }
  /** Confirmed, but it no longer matches a *pending* top-up row (already reconciled, or edited). */
  | { outcome: "topup_mismatch" }
  /** Paystack did not answer usefully, or the database failed. Nothing was credited. */
  | { outcome: "provider_error" };

export async function reconcileTopUpPayment(input: {
  reference: string;
  userId: string;
  userEmail: string;
}): Promise<TopUpReconciliation> {
  const { reference, userId, userEmail } = input;

  if (isPreviewDatabase() || !isPaystackConfigured()) {
    return { outcome: "not_configured" };
  }

  // Read the top-up first: never let one account probe another account's
  // Paystack reference, and never spend a provider call on a reference that is
  // not this customer's.
  const [topup] = await db
    .select()
    .from(paymentTopups)
    .where(and(eq(paymentTopups.reference, reference), eq(paymentTopups.userId, userId)))
    .limit(1);
  if (!topup) return { outcome: "not_found" };

  const result = await verifyPayment(reference);
  const payment = result.data;
  if (result.status !== true || !payment) {
    logger.warn("Top-up verification returned no data", { reference, userId });
    return { outcome: "provider_error" };
  }

  const payerEmail = payment.customer?.email?.toLowerCase();
  if (payerEmail && payerEmail !== userEmail.toLowerCase()) {
    logger.error("Top-up verification for the wrong customer", { reference, userId });
    return { outcome: "wrong_customer" };
  }

  // Check the provider's details for every status, not just success. A
  // mismatched or incomplete response is unconfirmed, not a failed charge.
  //
  // Each comparison reports itself separately. This used to be one compound
  // condition behind one warning that said payment details had mismatched
  // without saying which, so a deposit confirmed by Paystack but stranded as
  // pending could not be diagnosed from the log at all. parsePaystackResponse
  // casts the JSON without validating it, so the recorded types matter: a
  // stringified amount and a missing one look identical under `!==`.
  const mismatches: string[] = [];
  if (payment.reference !== reference) {
    mismatches.push(`reference: provider sent ${JSON.stringify(payment.reference)}, expected ${JSON.stringify(reference)}`);
  }
  if (payment.currency !== "NGN") {
    mismatches.push(`currency: provider sent ${JSON.stringify(payment.currency)}, expected "NGN"`);
  }
  // `payment.amount` is the gross the customer actually paid. When "Pass fees
  // to customers" is enabled in the Paystack dashboard, Paystack grosses it up
  // and keeps the difference, so a N50,000 top-up is charged as N50,862.95 and
  // comparing the gross against the stored net rejected every confirmed
  // payment. `requested_amount` is the net we asked for at initialize, so that
  // is what the stored top-up is compared against. A missing or null
  // requested_amount falls back to the gross, which is both the pre-existing
  // behaviour and the correct answer when fees are not passed on.
  const grossKobo = typeof payment.amount === "number" && Number.isSafeInteger(payment.amount) ? payment.amount : null;
  const requestedKobo =
    typeof payment.requested_amount === "number" && Number.isSafeInteger(payment.requested_amount)
      ? payment.requested_amount
      : grossKobo;
  if (requestedKobo === null) {
    mismatches.push(
      `amount: no usable integer, provider sent requested_amount ${JSON.stringify(payment.requested_amount)} and amount ${JSON.stringify(payment.amount)} (typeof ${typeof payment.amount})`,
    );
  } else if (requestedKobo !== topup.amount * 100) {
    mismatches.push(
      `amount: provider requested ${requestedKobo} kobo, expected ${topup.amount * 100} kobo from the stored ${topup.amount} naira (charged ${JSON.stringify(payment.amount)} kobo, fees ${JSON.stringify(payment.fees)})`,
    );
  } else if (grossKobo !== null && grossKobo < requestedKobo) {
    // A successful charge must not be short of what we asked for.
    mismatches.push(
      `amount: charged ${grossKobo} kobo is less than the ${requestedKobo} kobo requested, so the payment was short`,
    );
  }
  if (mismatches.length > 0) {
    logger.warn("Top-up verification returned mismatched payment details", {
      reference,
      userId,
      mismatch: mismatches.join(" | "),
    });
    return { outcome: "mismatch", details: mismatches };
  }

  if (payment.status !== "success") {
    logger.info("Top-up is not confirmed as successful", { reference, status: payment.status, userId });
    // A previously credited payment with a later conflicting status needs
    // reconciliation, not an assertion that the wallet was never credited.
    if (topup.status === "completed") {
      return { outcome: "credited_status_conflict", providerStatus: payment.status };
    }
    if (payment.status === "failed" || payment.status === "reversed") {
      return { outcome: "failed", providerStatus: payment.status, amount: topup.amount };
    }
    // This includes ongoing, pending, processing, queued, abandoned and
    // unrecognized statuses. None is proof that a charge definitively failed.
    return { outcome: "pending", providerStatus: payment.status, amount: topup.amount };
  }

  const outcome = await completeTopUp({ reference, userId, amount: topup.amount });
  if (outcome === "mismatch") {
    logger.warn("Top-up verification did not match a pending top-up", { reference, userId });
    return { outcome: "topup_mismatch" };
  }

  // A receipt is based on the committed wallet ledger, not the redirect or
  // provider response alone. It is historical, not a current balance.
  const [entry] = await db
    .select({
      amount: walletTransactions.amount,
      balanceAfter: walletTransactions.balanceAfter,
      createdAt: walletTransactions.createdAt,
    })
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.userId, userId),
        eq(walletTransactions.reference, reference),
        eq(walletTransactions.type, "credit"),
        eq(walletTransactions.amount, topup.amount),
      ),
    )
    .limit(1);
  if (!entry) throw new Error("Confirmed top-up ledger entry missing");

  return {
    outcome: "credited",
    amount: entry.amount,
    balanceAfter: entry.balanceAfter,
    creditedAt: entry.createdAt,
    duplicate: outcome === "duplicate",
  };
}
