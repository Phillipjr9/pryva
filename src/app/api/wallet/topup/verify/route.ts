import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { paymentTopups, walletTransactions } from "@/db/schema";
import { requireAuthApi } from "@/lib/auth";
import { isPaystackConfigured, verifyPayment } from "@/lib/paystack";
import { completeTopUp } from "@/lib/topups";
import { logger } from "@/lib/logger";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { isSameOriginMutation } from "@/lib/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { purchaseRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * The Paystack return URL is a hint, never evidence of payment. Verification
 * and signed webhooks use the same transactional, idempotent credit path.
 */
export async function POST(request: NextRequest) {
  const user = await requireAuthApi();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON." }, { status: 415 });
  if (isPreviewDatabase() || !isPaystackConfigured()) {
    return NextResponse.json({ error: "Payments are not configured yet." }, { status: 503 });
  }
  const limit = await purchaseRateLimiter(`topup-verify:${user.id}`);
  if (limit.unavailable) return NextResponse.json({ error: "Payment verification is temporarily unavailable." }, { status: 503 });
  if (!limit.allowed) return NextResponse.json({ error: "Too many verification attempts. Please try again later." }, { status: 429 });

  let body: unknown;
  try {
    body = await readJsonWithLimit(request, 2_048);
  } catch (error) {
    return NextResponse.json({ error: "Invalid request body" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  const rawReference = (body as { reference?: unknown }).reference;
  const reference = typeof rawReference === "string" ? rawReference.trim() : "";
  if (!reference || !/^[A-Za-z0-9._-]{6,40}$/.test(reference)) {
    return NextResponse.json({ error: "Invalid payment reference." }, { status: 400 });
  }

  try {
    // Do not let one account probe another account's Paystack reference.
    const [topup] = await db.select().from(paymentTopups)
      .where(and(eq(paymentTopups.reference, reference), eq(paymentTopups.userId, user.id))).limit(1);
    if (!topup) {
      return NextResponse.json({ error: "Payment reference not found for this account." }, { status: 404 });
    }

    const result = await verifyPayment(reference);
    const payment = result.data;
    if (result.status !== true || !payment) {
      logger.warn("Top-up verification returned no data", { reference, userId: user.id });
      return NextResponse.json({ error: "We couldn't confirm the payment. Check your wallet history or contact support with the reference before paying again." }, { status: 502 });
    }

    const payerEmail = payment.customer?.email?.toLowerCase();
    if (payerEmail && payerEmail !== user.email.toLowerCase()) {
      logger.error("Top-up verification for the wrong customer", { reference, userId: user.id });
      return NextResponse.json({ error: "That payment doesn't belong to this account." }, { status: 403 });
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
    const requestedKobo = typeof payment.requested_amount === "number" && Number.isSafeInteger(payment.requested_amount)
      ? payment.requested_amount
      : grossKobo;
    if (requestedKobo === null) {
      mismatches.push(`amount: no usable integer, provider sent requested_amount ${JSON.stringify(payment.requested_amount)} and amount ${JSON.stringify(payment.amount)} (typeof ${typeof payment.amount})`);
    } else if (requestedKobo !== topup.amount * 100) {
      mismatches.push(`amount: provider requested ${requestedKobo} kobo, expected ${topup.amount * 100} kobo from the stored ${topup.amount} naira (charged ${JSON.stringify(payment.amount)} kobo, fees ${JSON.stringify(payment.fees)})`);
    } else if (grossKobo !== null && grossKobo < requestedKobo) {
      // A successful charge must not be short of what we asked for.
      mismatches.push(`amount: charged ${grossKobo} kobo is less than the ${requestedKobo} kobo requested, so the payment was short`);
    }
    if (mismatches.length > 0) {
      logger.warn("Top-up verification returned mismatched payment details", {
        reference,
        userId: user.id,
        mismatch: mismatches.join(" | "),
      });
      return NextResponse.json({ error: "Payment details could not be verified. Contact support with your reference before paying again." }, { status: 409 });
    }

    if (payment.status !== "success") {
      logger.info("Top-up is not confirmed as successful", { reference, status: payment.status, userId: user.id });
      // A previously credited payment with a later conflicting status needs
      // reconciliation, not an assertion that the wallet was never credited.
      if (topup.status === "completed") {
        return NextResponse.json({ error: "This payment was credited earlier, but its current provider status needs review. Contact support with the reference." }, { status: 409 });
      }
      if (payment.status === "failed" || payment.status === "reversed") {
        return NextResponse.json({ ok: false, status: "failed", error: payment.status === "reversed"
          ? "Paystack reports that this payment was reversed. Check your wallet history or contact support with the reference."
          : "Paystack reports that this payment failed. Check your wallet history or contact support with the reference before paying again." }, { status: 402 });
      }
      // This includes ongoing, pending, processing, queued, abandoned and
      // unrecognized statuses. None is proof that a charge definitively failed.
      return NextResponse.json({ ok: true, status: "pending", message: "Payment is not confirmed yet. Check this reference again or contact support before paying again." }, { status: 202 });
    }

    const outcome = await completeTopUp({ reference, userId: user.id, amount: topup.amount });
    if (outcome === "mismatch") {
      logger.warn("Top-up verification did not match a pending top-up", { reference, userId: user.id });
      return NextResponse.json({ error: "That payment doesn't match a pending top-up. Contact support with your reference." }, { status: 409 });
    }

    // A receipt is based on the committed wallet ledger, not the redirect or
    // provider response alone. It is historical, not a current balance.
    const [entry] = await db.select({ amount: walletTransactions.amount, balanceAfter: walletTransactions.balanceAfter, createdAt: walletTransactions.createdAt })
      .from(walletTransactions)
      .where(and(eq(walletTransactions.userId, user.id), eq(walletTransactions.reference, reference), eq(walletTransactions.type, "credit"), eq(walletTransactions.amount, topup.amount)))
      .limit(1);
    if (!entry) throw new Error("Confirmed top-up ledger entry missing");

    return NextResponse.json({
      ok: true,
      status: "completed",
      credited: outcome === "credited",
      reason: outcome === "duplicate" ? "already_credited" : undefined,
      receipt: { reference, amount: entry.amount, balanceAfter: entry.balanceAfter, creditedAt: entry.createdAt },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    logger.error("Top-up verification failed", { reference, userId: user.id, detail: "provider or database unavailable" });
    return NextResponse.json({ error: "We couldn't verify the payment. Check your wallet history or contact support with the reference before paying again." }, { status: 502 });
  }
}
