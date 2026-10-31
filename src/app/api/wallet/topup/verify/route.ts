import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { logger } from "@/lib/logger";
import { isSameOriginMutation } from "@/lib/net";
import { isPaystackConfigured } from "@/lib/paystack";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { purchaseRateLimiter } from "@/lib/rate-limit";
import { reconcileTopUpPayment } from "@/lib/topup-reconciliation";

export const dynamic = "force-dynamic";

/**
 * The Paystack return URL is a hint, never evidence of payment. Verification
 * and signed webhooks use the same transactional, idempotent credit path.
 *
 * Every check lives in `reconcileTopUpPayment` (src/lib/topup-reconciliation.ts),
 * because the support assistant needs to ask the same question — "did this
 * deposit actually arrive?" — and two implementations of that answer would
 * eventually disagree. This route only maps the answer onto HTTP.
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
    const result = await reconcileTopUpPayment({ reference, userId: user.id, userEmail: user.email });

    switch (result.outcome) {
      case "not_configured":
        return NextResponse.json({ error: "Payments are not configured yet." }, { status: 503 });
      case "not_found":
        return NextResponse.json({ error: "Payment reference not found for this account." }, { status: 404 });
      case "wrong_customer":
        return NextResponse.json({ error: "That payment doesn't belong to this account." }, { status: 403 });
      case "provider_error":
        return NextResponse.json({
          error:
            "We couldn't confirm the payment. Check your wallet history or contact support with the reference before paying again.",
        }, { status: 502 });
      case "mismatch":
        return NextResponse.json({
          error: "Payment details could not be verified. Contact support with your reference before paying again.",
        }, { status: 409 });
      case "credited_status_conflict":
        return NextResponse.json({
          error: "This payment was credited earlier, but its current provider status needs review. Contact support with the reference.",
        }, { status: 409 });
      case "topup_mismatch":
        return NextResponse.json({ error: "That payment doesn't match a pending top-up. Contact support with your reference." }, { status: 409 });
      case "failed":
        return NextResponse.json({
          ok: false,
          status: "failed",
          error:
            result.providerStatus === "reversed"
              ? "Paystack reports that this payment was reversed. Check your wallet history or contact support with the reference."
              : "Paystack reports that this payment failed. Check your wallet history or contact support with the reference before paying again.",
        }, { status: 402 });
      case "pending":
        return NextResponse.json({
          ok: true,
          status: "pending",
          message: "Payment is not confirmed yet. Check this reference again or contact support before paying again.",
        }, { status: 202 });
      case "credited":
        return NextResponse.json({
          ok: true,
          status: "completed",
          credited: !result.duplicate,
          reason: result.duplicate ? "already_credited" : undefined,
          receipt: {
            reference,
            amount: result.amount,
            balanceAfter: result.balanceAfter,
            creditedAt: result.creditedAt,
          },
        }, { headers: { "Cache-Control": "private, no-store" } });
    }
  } catch {
    logger.error("Top-up verification failed", { reference, userId: user.id, detail: "provider or database unavailable" });
    return NextResponse.json({
      error: "We couldn't verify the payment. Check your wallet history or contact support with the reference before paying again.",
    }, { status: 502 });
  }
}
