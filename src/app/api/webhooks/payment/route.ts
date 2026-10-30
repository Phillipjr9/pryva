import { NextRequest, NextResponse } from "next/server";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { verifyPaystackSignature } from "@/lib/paystack-webhook";
import { completeTopUp } from "@/lib/topups";
import { logger } from "@/lib/logger";
import { readTextWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const dynamic = "force-dynamic";

/** Verify the raw Paystack payload and credit only a matching pending top-up. */
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
      currency?: unknown;
      metadata?: unknown;
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
  // Other Paystack events do not credit a wallet.
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
  const kobo = data?.amount;
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
