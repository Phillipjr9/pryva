/**
 * The OAuth `state` parameter, carried both in a cookie and in the parameter
 * itself.
 *
 * The cookie alone is not reliable. Google sends the browser back with a
 * cross-site request, and `SameSite=Lax` cookies are not guaranteed to accompany
 * it: Chrome's `Lax+POST` exemption covers a top-level POST, and this return is a
 * redirect GET. When the cookie is withheld, the callback fails its equality
 * check and redirects to `/login?error=google-state` — which reads like a
 * misconfigured redirect URI but is not, and is close to undiagnosable from the
 * console.
 *
 * So the state is signed and travels in the URL, where no cookie policy can drop
 * it. The cookie is still written and still read first, so a same-site or
 * browser-compatible return keeps the tighter check; the signature is what makes
 * the parameter trustworthy when the cookie is absent.
 *
 * The signature needs a secret. `GOOGLE_CLIENT_SECRET` is used because it is
 * already required for OAuth to work at all and is never sent to a browser — a
 * separate key would be one more thing to set, and its absence would be another
 * way for sign-in to break silently. Nothing is signed at all while that secret
 * is unset, because `googleConfigured()` already refuses the flow in that case.
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
 * Expiry is checked here rather than trusted from the cookie, because the whole
 * point of this path is that the cookie may be missing. A signed state that
 * outlives its window is a replay, not a login.
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
 * Whether the returning request may proceed.
 *
 * A cookie that is present must match exactly — if one was sent, it is the
 * stronger evidence and a disagreement means something is wrong. When it is
 * absent, a valid signature carries the request instead.
 */
export function stateAccepted(
  returned: string | null | undefined,
  cookieValue: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!returned) return false;
  if (cookieValue) return constantTimeEqual(cookieValue, returned);
  return verifyState(returned, now);
}
