import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { isPaystackConfigured, verifyPayment } from "@/lib/paystack";
import { creditTopUpOnce, isReferenceCredited } from "@/lib/payments";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/wallet/topup/verify  { reference }
 *
 * Called by the wallet page when Paystack redirects back with
 * `?topup=success&reference=…`. We never trust that redirect: the money is only
 * credited after Paystack's own verify endpoint says the charge succeeded.
 *
 * Safe to call repeatedly — crediting is idempotent per reference, and this is
 * also the path that runs if the webhook arrives late.
 */
export async function POST(request: NextRequest) {
  const user = await requireAuth(request);
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

  if (await isReferenceCredited(reference)) {
    return NextResponse.json({ ok: true, credited: false, reason: "already_credited" });
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

    // The reference must belong to this account — otherwise someone could ask
    // us to credit their wallet with another customer's payment.
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

    const credited = await creditTopUpOnce({
      reference,
      amountNgn: Math.round(Number(payment.amount) / 100),
      userId: user.id,
      description: "Wallet top-up",
    });

    if (!credited.credited) {
      // Most likely the webhook won the race — that's a success, not an error.
      return NextResponse.json({ ok: true, credited: false, reason: credited.reason });
    }

    return NextResponse.json({ ok: true, credited: true, balance: credited.balance });
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
