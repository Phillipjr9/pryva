import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * TOTP (RFC 6238) with the parameters every authenticator app defaults to:
 * HMAC-SHA1, a 30-second step and six digits.
 *
 * Implemented here rather than pulled in as a dependency because the surface is
 * small and every input is security-relevant. Two rules in this file matter:
 *
 *   * comparison is constant-time, so a wrong code cannot be discovered digit by
 *     digit from response timing;
 *   * a code carries the step it matched, because accepting the same code twice
 *     inside its window is a replay — the caller records the step it used.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DEFAULT_DIGITS = 6;
/** ±1 step, the usual tolerance for clock drift between phone and server. */
export const DEFAULT_WINDOW = 1;

/** Unpadded RFC 4648 base32, the format authenticator apps exchange. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  if (!clean) throw new Error("Empty base32 value");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const character of clean) {
    const index = ALPHABET.indexOf(character);
    if (index === -1) throw new Error("Invalid base32 character");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160 bits, the size RFC 4226 recommends for a shared secret. */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/** The `otpauth://` URI an authenticator app scans or accepts by hand. */
export function totpUri(secret: string, account: string, issuer = "Pryva"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DEFAULT_DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function hotp(key: Buffer, counter: number, digits: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** The code for a specific time step. Exported for tests and for diagnostics. */
export function totpAt(secret: string, step: number, digits = DEFAULT_DIGITS): string {
  return hotp(base32Decode(secret), step, digits);
}

export function currentStep(now: number = Date.now()): number {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type TotpVerification =
  | { ok: true; step: number }
  | { ok: false; reason: "malformed" | "no-match" };

/**
 * Verify a submitted code against a window of steps.
 *
 * `rejectUpToStep` is the last step already used for this account. A code from
 * that step or earlier is refused even when it still matches, because it has
 * already been spent.
 */
export function verifyTotp(
  secret: string,
  token: unknown,
  options: { now?: number; window?: number; rejectUpToStep?: number | null } = {},
): TotpVerification {
  if (typeof token !== "string") return { ok: false, reason: "malformed" };
  const code = token.replace(/[\s-]/g, "");
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: "malformed" };

  const now = options.now ?? Date.now();
  const window = options.window ?? DEFAULT_WINDOW;
  const current = currentStep(now);
  const rejectUpTo = options.rejectUpToStep ?? null;

  let matched: number | null = null;
  for (let delta = -window; delta <= window; delta += 1) {
    const step = current + delta;
    if (step < 0) continue;
    if (constantTimeEqual(hotp(base32Decode(secret), step, DEFAULT_DIGITS), code)) {
      // Keep scanning: never return early on the first match in a way that leaks
      // which step matched through timing.
      matched = step;
    }
  }
  if (matched === null) return { ok: false, reason: "no-match" };
  if (rejectUpTo !== null && matched <= rejectUpTo) return { ok: false, reason: "no-match" };
  return { ok: true, step: matched };
}
