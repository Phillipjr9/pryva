/**
 * Invite codes, and the cookie that remembers one.
 *
 * Kept free of the database on purpose: the sign-up form is a client component
 * and needs to validate and store a code before the account exists, so anything
 * it imports must be safe to ship to a browser. The server-side half lives in
 * `src/lib/referrals.ts`.
 */

export const REFERRAL_CODE_LENGTH = 8;
/** No 0/O/1/I/L: a code gets read aloud and typed by hand. */
export const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const REFERRAL_COOKIE = "pryva_ref";
export const REFERRAL_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * A code as a human would type it, or `null`.
 *
 * Case and surrounding whitespace are forgiven; anything that is not exactly
 * eight characters from the alphabet is refused rather than guessed at, because
 * a fuzzy match on codes would attribute an invitation to the wrong account.
 */
export function normalizeReferralCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.trim().toUpperCase();
  if (code.length !== REFERRAL_CODE_LENGTH) return null;
  for (const character of code) {
    if (!REFERRAL_CODE_ALPHABET.includes(character)) return null;
  }
  return code;
}

export function makeReferralCode(random: () => number = Math.random): string {
  let code = "";
  for (let index = 0; index < REFERRAL_CODE_LENGTH; index += 1) {
    code += REFERRAL_CODE_ALPHABET[Math.floor(random() * REFERRAL_CODE_ALPHABET.length)] ?? "X";
  }
  return code;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return rest.join("=");
      }
    }
  }
  return null;
}

/**
 * The invite code for this request, from the body or from the cookie the signup
 * page sets.
 *
 * The cookie is the one that survives a detour: somebody lands on
 * `/signup?ref=ABC23456`, decides to use Google instead, and comes back a minute
 * later — the code is still there. A code in the body wins, because it is the
 * more specific statement of intent.
 */
export function readReferralCodeFrom(request: Request, bodyValue?: unknown): string | null {
  const fromBody = normalizeReferralCode(bodyValue);
  if (fromBody) return fromBody;
  return normalizeReferralCode(readCookie(request, REFERRAL_COOKIE));
}
