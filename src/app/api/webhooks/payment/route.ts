import { NextRequest, NextResponse } from "next/server";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { verifyPaystackSignature } from "@/lib/paystack-webhook";
import { completeTopUp } from "@/lib/topups";
import { isTransferEvent, settleTransferEvent } from "@/lib/paystack-transfer-settlement";
import { logger } from "@/lib/logger";
import { readTextWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const dynamic = "force-dynamic";

/**
 * Paystack's signed word on two things: a customer paid us, and a payout reached
 * its destination (or did not).
 *
 * The body is untrusted until the HMAC over the raw bytes checks out, and every
 * event is applied against a row we already have. See
 * `src/lib/paystack-transfer-settlement.ts` for why a `transfer.success` only
 * completes an in-flight row and a `transfer.failed` refunds the wallet.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!secret || isPreviewDatabase()) {
    return NextResponse.json({ error: "Payment webhook is not configured" }, { status: 503 });
  }

  let rawBody: string;
  try {
    rawBody = await readTextWithLimit(request, 131_072);
  } catch (error) {
    return NextResponse.json({ error: "Invalid payload" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
  }
  if (!verifyPaystackSignature(rawBody, request.headers.get("x-paystack-signature"), secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: {
    event?: unknown;
    data?: {
      status?: unknown;
      reference?: unknown;
      amount?: unknown;
      requested_amount?: unknown;
      currency?: unknown;
      metadata?: unknown;
      transfer_code?: unknown;
      reason?: unknown;
      gateway_response?: unknown;
    };
  };
  try {
    payload = JSON.parse(rawBody.replace(/^\uFEFF/, ""));
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  if (typeof payload.event === "string" && isTransferEvent(payload.event)) {
    return applyTransferEvent(payload.event, payload.data);
  }

  // Other Paystack events do not move money here.
  if (payload.event !== "charge.success") return NextResponse.json({ ok: true });

  const data = payload.data;
  // Paystack metadata can be returned as an object or a JSON string. Both
  // forms are untrusted until the raw-body signature and fields are checked.
  let metadata: unknown = data?.metadata;
  if (typeof metadata === "string" && metadata.length <= 4_096) {
    try { metadata = JSON.parse(metadata); } catch { metadata = null; }
  }
  const details = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as { userId?: unknown; type?: unknown } : null;
  const userId = details?.userId;
  const reference = data?.reference;
  const chargedKobo = data?.amount;
  // `amount` is the gross the customer paid. With "Pass fees to customers" on in
  // the Paystack dashboard that exceeds the net we requested and can be a
  // fractional naira figure, which both mismatches the stored top-up and fails
  // the whole-naira check below -- so a fee-bearing charge.success could never
  // credit a wallet through this route. Match the net we asked for instead, and
  // fall back to the gross when Paystack does not report one, which is the
  // correct figure when fees are not being passed on.
  const kobo = Number.isSafeInteger(data?.requested_amount) ? data?.requested_amount : chargedKobo;
  if (
    data?.status !== "success" ||
    data.currency !== "NGN" ||
    details?.type !== "wallet_topup" ||
    typeof userId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId) ||
    typeof reference !== "string" || reference.length > 40 || reference.length === 0 ||
    typeof kobo !== "number" || !Number.isSafeInteger(kobo) || kobo < 10000 || kobo > 1000000000 || kobo % 100 !== 0
  ) {
    // This rejection previously returned 400 with nothing logged, so a webhook
    // that refused to credit a real payment left no evidence anywhere -- not in
    // the response, which Paystack does not surface, and not in the log. Records
    // what was received rather than what was expected, because the payload is
    // untrusted and the interesting case is a field arriving in the wrong shape.
    logger.warn("Paystack event rejected: invalid payment details", {
      reference: typeof reference === "string" ? reference : null,
      status: data?.status,
      currency: data?.currency,
      metadataType: details?.type,
      metadataUserId: typeof userId === "string" ? userId : null,
      amountType: typeof kobo,
      amount: typeof kobo === "number" || typeof kobo === "string" ? kobo : null,
      chargedAmount: typeof chargedKobo === "number" || typeof chargedKobo === "string" ? chargedKobo : null,
      requestedAmount: typeof data?.requested_amount === "number" || typeof data?.requested_amount === "string"
        ? data.requested_amount
        : null,
    });
    return NextResponse.json({ error: "Invalid payment details" }, { status: 400 });
  }
  const amount = kobo / 100;

  try {
    const result = await completeTopUp({ reference, userId, amount });

    if (result === "mismatch") {
      logger.warn("Paystack event did not match a pending top-up", { reference });
      return NextResponse.json({ error: "Payment does not match a pending top-up" }, { status: 400 });
    }

    logger.info("Paystack webhook processed", { reference, result });
    return NextResponse.json({ ok: true, duplicate: result === "duplicate" });
  } catch (error) {
    logger.error("Payment webhook processing failed", { error, reference });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}

/**
 * A payout event. The provider decides the fate of a transfer we initiated; this
 * only checks that the event describes the transfer we think it does.
 */
async function applyTransferEvent(
  event: Parameters<typeof settleTransferEvent>[0]["event"],
  data: { status?: unknown; reference?: unknown; amount?: unknown; currency?: unknown; transfer_code?: unknown; reason?: unknown; gateway_response?: unknown } | undefined,
) {
  const reference = data?.reference;
  const amountKobo = data?.amount;
  const providerStatus = typeof data?.status === "string" ? data.status : "";
  const transferCode = typeof data?.transfer_code === "string" && data.transfer_code.length <= 100 ? data.transfer_code : null;
  const reasonSource = typeof data?.reason === "string" ? data.reason : data?.gateway_response;

  if (
    typeof reference !== "string" || reference.length === 0 || reference.length > 50 ||
    typeof amountKobo !== "number" || !Number.isSafeInteger(amountKobo) || amountKobo <= 0 ||
    data?.currency !== "NGN"
  ) {
    logger.warn("Paystack transfer event rejected: invalid details", {
      event,
      reference: typeof reference === "string" ? reference : null,
      status: data?.status,
      currency: data?.currency,
      amountType: typeof amountKobo,
    });
    return NextResponse.json({ error: "Invalid transfer details" }, { status: 400 });
  }

  try {
    const outcome = await settleTransferEvent({
      event,
      reference,
      amountKobo,
      currency: "NGN",
      providerStatus,
      transferCode,
      reason: typeof reasonSource === "string" ? reasonSource : null,
    });

    if (outcome === "mismatch") {
      // A 400 makes the provider keep the failed delivery visible; a mismatch is
      // something a person has to read, not something a retry can fix.
      return NextResponse.json({ error: "Transfer event does not match a recorded withdrawal" }, { status: 400 });
    }

    logger.info("Paystack transfer webhook processed", { event, reference, outcome });
    return NextResponse.json({ ok: true, outcome });
  } catch (error) {
    logger.error("Paystack transfer webhook processing failed", { error, event, reference });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
