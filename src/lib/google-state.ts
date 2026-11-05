/**
 * Google OAuth state must be bound to the initiating browser. A signature on a
 * state value by itself is not that binding: an attacker can obtain a signed
 * state in their own browser and send their callback to someone else (login CSRF).
 *
 * The start route stores the random state in an HttpOnly, SameSite=Lax cookie on
 * the same host as the callback. The signature supplies an additional expiry and
 * integrity check; a matching browser cookie is mandatory for every return.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Ten minutes, matching the cookie's `Max-Age`. */
const STATE_TTL_MS = 10 * 60 * 1000;

export type StateParts = { nonce: string; issuedAt: number };

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, which is itself a difference
  // worth answering "no" to rather than turning into a 500.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * `nonce.issuedAt.signature`, URL-safe throughout.
 *
 * The nonce is a random hex string, so the dots are unambiguous separators.
 */
export function signState(nonce: string, now = Date.now()): string | null {
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!secret) return null;
  const issuedAt = now;
  const payload = `${nonce}.${issuedAt}`;
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * True when the state is authentic and fresh.
 *
 * Expiry is also checked server-side, even though the browser cookie expires. A
 * signed state that outlives its window is a replay, not a login.
 */
export function verifyState(value: string | null | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!secret) return false;

  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [nonce, issuedAtRaw, signature] = parts;
  const issuedAt = Number(issuedAtRaw);
  if (!nonce || !Number.isFinite(issuedAt)) return false;

  if (!constantTimeEqual(signature, sign(`${nonce}.${issuedAt}`, secret))) return false;

  const age = now - issuedAt;
  // A future timestamp is rejected too: clock skew is bounded, and accepting one
  // would make the window arbitrarily long.
  return age >= 0 && age <= STATE_TTL_MS;
}

/**
 * A matching cookie is mandatory, including for a correctly signed state. Bare
 * forty-character nonces from the previous release remain valid only with their
 * matching cookie, so an OAuth flow already in flight can finish during rollout.
 */
export function stateAccepted(
  returned: string | null | undefined,
  cookieValue: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!returned || !cookieValue || !constantTimeEqual(cookieValue, returned)) return false;
  return /^[a-f0-9]{40}$/i.test(returned) || verifyState(returned, now);
}
