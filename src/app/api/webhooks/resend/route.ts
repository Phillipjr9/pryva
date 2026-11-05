import { NextRequest, NextResponse } from "next/server";

import { isPreviewDatabase } from "@/lib/demo-policy";
import { logger } from "@/lib/logger";
import { readTextWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { recordEmailDeliveryEvent } from "@/lib/email-delivery-events";
import {
  normaliseEventName,
  recipientDomain,
  resendOutcome,
  verifyResendSignature,
} from "@/lib/resend-webhook";

export const dynamic = "force-dynamic";

/**
 * Resend's signed word on what happened to a message after we handed it over.
 *
 * Same shape as the payment webhook, for the same reason: a public endpoint that
 * changes a delivery record has to know the sender before it believes anything.
 * The body is untrusted until the Svix signature over the raw bytes checks out.
 *
 * The raw body is read as text and verified *before* parsing. Verifying a
 * re-serialised `JSON.stringify(parsed)` never matches, because it does not
 * reproduce the bytes that were signed — an endpoint written that way rejects
 * every genuine delivery and looks exactly like one that was never configured.
 *
 * Returning a non-2xx makes Resend retry, so this answers 200 for anything it has
 * accepted or deliberately dropped, and 5xx only when the write genuinely failed.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret || isPreviewDatabase()) {
    return NextResponse.json({ error: "Email webhook is not configured" }, { status: 503 });
  }

  let rawBody: string;
  try {
    rawBody = await readTextWithLimit(request, 262_144);
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid payload" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }

  const signatureValid = verifyResendSignature({
    body: rawBody,
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
    secret,
  });

  if (!signatureValid) {
    // The body is attacker-controlled here, so nothing from it is stored.
    void recordEmailDeliveryEvent({
      providerEventId: null,
      event: null,
      signatureValid: false,
      outcome: "rejected_signature",
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: {
    type?: unknown;
    data?: { email_id?: unknown; to?: unknown };
  };
  try {
    payload = JSON.parse(rawBody.replace(/^\uFEFF/, ""));
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const event = normaliseEventName(payload.type);
  const outcome = resendOutcome(payload.type);

  // Acknowledged but not stored: Resend sends event types we have no use for
  // (`email.delivery_delayed`, marketing), and recording them would make the log
  // harder to read rather than more informative.
  if (!event) {
    void recordEmailDeliveryEvent({
      providerEventId: request.headers.get("svix-id"),
      event: "unknown",
      signatureValid: true,
      outcome: "rejected_details",
    });
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    await recordEmailDeliveryEvent({
      providerEventId: request.headers.get("svix-id"),
      event,
      messageId: payload.data?.email_id,
      recipientDomain: recipientDomain(
        Array.isArray(payload.data?.to) ? payload.data?.to[0] : payload.data?.to,
      ),
      signatureValid: true,
      outcome,
    });
  } catch (error) {
    // Only reached if the write itself failed, which is the one case worth a
    // retry. `recordEmailDeliveryEvent` swallows its own errors, so this covers
    // the call not completing at all.
    logger.warn("Resend webhook could not be recorded", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Could not record event" }, { status: 503 });
  }

  return NextResponse.json({ ok: true, outcome });
}
