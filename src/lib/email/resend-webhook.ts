import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Resend signs its webhooks through Svix.
 *
 * The scheme is not Resend's own, and it is easy to get subtly wrong by copying a
 * generic HMAC example: the key is the base64 payload *after* the `whsec_`
 * prefix (not the literal secret string), the signed content joins the id, the
 * timestamp and the raw body with periods, and the signature header may carry
 * several space-separated `v1,<base64>` tokens because a secret can be rotated
 * without a gap.
 *
 * Two mistakes this exists to avoid:
 *
 *  • verifying a re-serialised body. `JSON.parse` then `JSON.stringify` changes
 *    bytes, so the signature never matches and the endpoint silently rejects
 *    everything. The route must hand over the raw text.
 *  • skipping the timestamp. Without it a captured delivery replays forever. The
 *    timestamp is inside the signed string, so an attacker cannot refresh it —
 *    but only if it is checked at all.
 */
const TOLERANCE_SECONDS = 5 * 60;
const PREFIX = "whsec_";

export type ResendSignatureInput = {
  body: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  secret: string;
  now?: number;
};

export function verifyResendSignature(input: ResendSignatureInput): boolean {
  const { body, id, timestamp, signature, secret } = input;
  const now = input.now ?? Date.now();

  if (!id || !timestamp || !signature) return false;
  if (!secret.startsWith(PREFIX)) return false;

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return false;
  // Both directions: a timestamp far in the future would otherwise make the
  // replay window arbitrarily long.
  if (Math.abs(now / 1000 - seconds) > TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.slice(PREFIX.length), "base64");
  if (key.length === 0) return false;

  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`, "utf8")
    .digest();

  // Any listed signature may match, and a non-matching first entry must not end
  // the search: that is what a rotation in progress looks like.
  return signature.split(" ").some((entry) => {
    const comma = entry.indexOf(",");
    if (comma < 0) return false;
    if (entry.slice(0, comma) !== "v1") return false;
    const received = Buffer.from(entry.slice(comma + 1), "base64");
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}

/**
 * The recipient's domain, never the mailbox.
 *
 * Enough to see that one provider is refusing everything we send it, which is the
 * failure worth noticing, without this table becoming a second copy of the
 * customer list.
 */
export function recipientDomain(address: unknown): string | null {
  if (typeof address !== "string") return null;
  const at = address.lastIndexOf("@");
  if (at < 0 || at === address.length - 1) return null;
  const domain = address.slice(at + 1).trim().toLowerCase();
  if (!domain || domain.length > 200 || /[\s\r\n]/.test(domain)) return null;
  return domain;
}

/**
 * Which of Resend's events we record, and what each one means for the message.
 *
 * Deliberately a closed vocabulary: `email.delivery_delayed` and marketing events
 * are acknowledged and dropped rather than stored under a name nobody will
 * search for later.
 */
export type EmailOutcome =
  | "delivered"
  | "bounced"
  | "complained"
  | "opened"
  | "clicked"
  | "scheduled"
  | "sent"
  | "ignored"
  | "rejected_signature"
  | "rejected_details";

const EVENT_OUTCOMES: Record<string, EmailOutcome> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.scheduled": "scheduled",
  "email.sent": "sent",
};

export function resendOutcome(event: unknown): EmailOutcome {
  if (typeof event !== "string") return "ignored";
  return EVENT_OUTCOMES[event.trim()] ?? "ignored";
}

/** Resend's event names are a closed set; anything longer is not one of theirs. */
export function normaliseEventName(event: unknown): string | null {
  if (typeof event !== "string") return null;
  const trimmed = event.trim();
  if (!trimmed || trimmed.length > 60) return null;
  return trimmed;
}
