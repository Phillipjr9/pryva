import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth";
import { isPaystackConfigured, verifyPayment } from "@/lib/paystack";
import { completeTopUp } from "@/lib/topups";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/wallet/topup/verify  { reference }
 *
 * Called by the wallet page when Paystack redirects back with
 * `?topup=success&reference=…`. The redirect is only a hint: the money is
 * credited only after Paystack's own verify endpoint confirms the charge, and
 * only through `completeTopUp()` — the same path the webhook uses, so a payment
 * confirmed twice still credits once.
 */
export async function POST(request: NextRequest) {
  const user = await requireAuthApi();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }

  if (!isPaystackConfigured()) {
    return NextResponse.json({ error: "Payments are not configured yet." }, { status: 503 });
  }

  let body: { reference?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const reference = typeof body.reference === "string" ? body.reference.trim().slice(0, 100) : "";
  if (!reference || !/^[A-Za-z0-9._-]{6,100}$/.test(reference)) {
    return NextResponse.json({ error: "Invalid payment reference." }, { status: 400 });
  }

  try {
    const result = await verifyPayment(reference);
    const payment = result.data;

    if (!result.status || !payment) {
      logger.warn("Top-up verification returned no data", { reference, userId: user.id });
      return NextResponse.json({ error: "We couldn't confirm that payment." }, { status: 402 });
    }

    if (payment.status !== "success") {
      logger.warn("Top-up verification: payment not successful", {
        reference,
        status: payment.status,
        userId: user.id,
      });
      return NextResponse.json({ ok: false, error: "That payment wasn't successful." }, { status: 402 });
    }

    // The payment must belong to this account — otherwise someone could ask us
    // to credit their wallet with another customer's payment.
    const payerEmail = payment.customer?.email?.toLowerCase();
    if (payerEmail && payerEmail !== user.email.toLowerCase()) {
      logger.error("Top-up verification for the wrong customer", {
        reference,
        userId: user.id,
        payerEmail,
      });
      return NextResponse.json({ error: "That payment doesn't belong to this account." }, { status: 403 });
    }

    if (payment.currency && payment.currency !== "NGN") {
      logger.warn("Top-up verification with unexpected currency", {
        reference,
        currency: payment.currency,
      });
      return NextResponse.json({ error: "Only Naira payments can be credited." }, { status: 400 });
    }

    const amount = Math.round(Number(payment.amount) / 100);
    const outcome = await completeTopUp({ reference: payment.reference ?? reference, userId: user.id, amount });

    if (outcome === "mismatch") {
      // No pending top-up for this reference (or the amount doesn't match what
      // the user asked for) — the webhook will report the same, so say it plainly.
      logger.warn("Top-up verification did not match a pending top-up", {
        reference,
        userId: user.id,
        amount,
      });
      return NextResponse.json(
        { error: "That payment doesn't match a pending top-up. Contact support with your reference." },
        { status: 409 },
      );
    }

    return NextResponse.json({
      ok: true,
      credited: outcome === "credited",
      reason: outcome === "duplicate" ? "already_credited" : undefined,
      // The figure the receipt counts up. It comes from the provider's charge
      // for this member's own reference, so it is safe to echo back — and it is
      // the one number the member came back to the page to see.
      amount,
    });
  } catch (error) {
    logger.error("Top-up verification failed", {
      reference,
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "We couldn't reach the payment provider. Your top-up will still arrive." },
      { status: 502 },
    );
  }
}
