import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { twoFactorChallenges, twoFactorRecoveryCodes, userTwoFactor } from "@/db/schema";
import { generateTotpSecret, totpUri, verifyTotp } from "@/lib/totp";

/**
 * Two-factor enrolment, recovery and sign-in challenges.
 *
 * ## Why the secret is encrypted
 *
 * A TOTP secret is the second factor. Stored as issued, a database dump — or a
 * read-only replica, or a support export — would let the holder generate valid
 * codes forever. It is encrypted with AES-256-GCM under `TWO_FACTOR_KEY`, and
 * when that key is absent the feature is **unavailable**, not degraded: a login
 * for an account with 2FA enabled fails closed rather than silently skipping the
 * second factor.
 *
 * ## Single use everywhere
 *
 *   * a challenge token is random, stored only as a SHA-256 hash, expires in five
 *     minutes and dies after five wrong codes;
 *   * a TOTP code's time-step is recorded when it is accepted, so the same code
 *     cannot be replayed inside its own window;
 *   * a recovery code is consumed with a conditional update, so two simultaneous
 *     requests cannot both spend it.
 */

const KEY_INFO = "pryva-two-factor-v1";
const KEY_MIN_LENGTH = 16;
export const RECOVERY_CODE_COUNT = 10;
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const MAX_CHALLENGE_ATTEMPTS = 5;

let cachedKey: { raw: string; key: Buffer } | null = null;

/** True when the feature can be used on this deployment at all. */
export function twoFactorAvailable(): boolean {
  const raw = process.env.TWO_FACTOR_KEY?.trim() ?? "";
  return raw.length >= KEY_MIN_LENGTH;
}

function encryptionKey(): Buffer {
  const raw = process.env.TWO_FACTOR_KEY?.trim() ?? "";
  if (raw.length < KEY_MIN_LENGTH) throw new Error("TWO_FACTOR_KEY is not configured");
  if (cachedKey?.raw !== raw) {
    // A deliberately slow KDF: the environment variable is a passphrase, not a
    // 32-byte key, and must not be used directly as one.
    cachedKey = { raw, key: scryptSync(raw, KEY_INFO, 32) };
  }
  return cachedKey.key;
}

export function encryptSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Unknown secret format");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(parts[1], "base64url"));
  decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(parts[3], "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return plaintext;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function hashChallengeToken(token: string): string {
  return sha256(token);
}

function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[\s-]/g, "");
}

/** `abcde-fghij`: ten hex characters in two groups, ~40 bits of entropy. */
export function generateRecoveryCode(): string {
  const hex = randomBytes(5).toString("hex");
  return `${hex.slice(0, 5)}-${hex.slice(5, 10)}`;
}

export type Enrolment = { enabledAt: Date | null; secret: string } | null;

export async function getEnrolment(userId: string): Promise<Enrolment> {
  const [row] = await db.select().from(userTwoFactor).where(eq(userTwoFactor.userId, userId)).limit(1);
  if (!row) return null;
  try {
    return { enabledAt: row.enabledAt ?? null, secret: decryptSecret(row.secretCiphertext) };
  } catch {
    // An undecryptable secret (rotated key, corrupt row) is not "no 2FA": the
    // account still has a second factor configured, it just cannot be checked.
    return { enabledAt: row.enabledAt ?? null, secret: "" };
  }
}

/**
 * Start or restart enrolment. Refuses to overwrite an enabled enrolment: turning
 * 2FA off must be an explicit, authenticated action, not a side effect of
 * starting again.
 */
export async function beginEnrolment(
  userId: string,
  account: string,
): Promise<{ ok: true; secret: string; uri: string } | { ok: false; reason: "already-enabled" }> {
  const existing = await getEnrolment(userId);
  if (existing?.enabledAt) return { ok: false, reason: "already-enabled" };

  const secret = generateTotpSecret();
  const ciphertext = encryptSecret(secret);
  if (existing) {
    await db
      .update(userTwoFactor)
      .set({ secretCiphertext: ciphertext, enabledAt: null, lastUsedStep: null })
      .where(eq(userTwoFactor.userId, userId));
  } else {
    await db.insert(userTwoFactor).values({
      userId,
      secretCiphertext: ciphertext,
      enabledAt: null,
      lastUsedStep: null,
    });
  }
  return { ok: true, secret, uri: totpUri(secret, account) };
}

export async function confirmEnrolment(
  userId: string,
  code: unknown,
): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; reason: "no-enrolment" | "invalid-code" }> {
  const [row] = await db.select().from(userTwoFactor).where(eq(userTwoFactor.userId, userId)).limit(1);
  if (!row || row.enabledAt) return { ok: false, reason: "no-enrolment" };

  let secret: string;
  try {
    secret = decryptSecret(row.secretCiphertext);
  } catch {
    return { ok: false, reason: "invalid-code" };
  }

  const verification = verifyTotp(secret, code);
  if (!verification.ok) return { ok: false, reason: "invalid-code" };

  const [enabled] = await db
    .update(userTwoFactor)
    .set({ enabledAt: new Date(), lastUsedStep: verification.step })
    .where(and(eq(userTwoFactor.userId, userId), isNull(userTwoFactor.enabledAt)))
    .returning({ userId: userTwoFactor.userId });
  if (!enabled) return { ok: false, reason: "no-enrolment" };

  return { ok: true, recoveryCodes: await issueRecoveryCodes(userId) };
}

/** Replace any earlier codes. The plaintext is returned once and never stored. */
export async function issueRecoveryCodes(userId: string): Promise<string[]> {
  await db.delete(twoFactorRecoveryCodes).where(eq(twoFactorRecoveryCodes.userId, userId));
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
  await db.insert(twoFactorRecoveryCodes).values(
    codes.map((code) => ({
      userId,
      codeHash: sha256(normalizeRecoveryCode(code)),
      usedAt: null,
    })),
  );
  return codes;
}

export async function remainingRecoveryCodes(userId: string): Promise<number> {
  const rows = await db
    .select({ id: twoFactorRecoveryCodes.id })
    .from(twoFactorRecoveryCodes)
    .where(and(eq(twoFactorRecoveryCodes.userId, userId), isNull(twoFactorRecoveryCodes.usedAt)));
  return rows.length;
}

/** Spend a recovery code. The conditional update is what makes it single-use. */
export async function consumeRecoveryCode(userId: string, code: unknown): Promise<boolean> {
  if (typeof code !== "string") return false;
  const normalized = normalizeRecoveryCode(code);
  if (!/^[0-9a-f]{10}$/.test(normalized)) return false;
  const hash = sha256(normalized);

  const [row] = await db
    .select({ id: twoFactorRecoveryCodes.id })
    .from(twoFactorRecoveryCodes)
    .where(
      and(
        eq(twoFactorRecoveryCodes.userId, userId),
        eq(twoFactorRecoveryCodes.codeHash, hash),
        isNull(twoFactorRecoveryCodes.usedAt),
      ),
    )
    .limit(1);
  if (!row) return false;

  const [spent] = await db
    .update(twoFactorRecoveryCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(twoFactorRecoveryCodes.id, row.id), isNull(twoFactorRecoveryCodes.usedAt)))
    .returning({ id: twoFactorRecoveryCodes.id });
  return Boolean(spent);
}

export type SecondFactorResult =
  | { ok: true; method: "totp" | "recovery" }
  | { ok: false; reason: "unavailable" | "not-enabled" | "invalid" };

/**
 * Check a code for a user. Never throws: the caller decides what an unavailable
 * second factor means, and for sign-in it must mean "do not issue a session".
 */
export async function verifySecondFactor(userId: string, code: unknown): Promise<SecondFactorResult> {
  if (!twoFactorAvailable()) return { ok: false, reason: "unavailable" };

  const [row] = await db.select().from(userTwoFactor).where(eq(userTwoFactor.userId, userId)).limit(1);
  if (!row || !row.enabledAt) return { ok: false, reason: "not-enabled" };

  let secret: string;
  try {
    secret = decryptSecret(row.secretCiphertext);
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  const verification = verifyTotp(secret, code, { rejectUpToStep: row.lastUsedStep ?? null });
  if (verification.ok) {
    // Conditional on the stored step, so two concurrent requests cannot both
    // accept the same code. Losing this race is treated as a replay.
    const [advanced] = await db
      .update(userTwoFactor)
      .set({ lastUsedStep: verification.step })
      .where(
        and(
          eq(userTwoFactor.userId, userId),
          or(isNull(userTwoFactor.lastUsedStep), lt(userTwoFactor.lastUsedStep, verification.step)),
        ),
      )
      .returning({ userId: userTwoFactor.userId });
    if (!advanced) return { ok: false, reason: "invalid" };
    return { ok: true, method: "totp" };
  }

  if (await consumeRecoveryCode(userId, code)) return { ok: true, method: "recovery" };
  return { ok: false, reason: "invalid" };
}

/** Stops 2FA and clears every recovery code. Requires a verified second factor. */
export async function disableTwoFactor(userId: string): Promise<void> {
  await db.delete(twoFactorChallenges).where(eq(twoFactorChallenges.userId, userId));
  await db.delete(twoFactorRecoveryCodes).where(eq(twoFactorRecoveryCodes.userId, userId));
  await db.delete(userTwoFactor).where(eq(userTwoFactor.userId, userId));
}

export async function createChallenge(
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);
  await db.insert(twoFactorChallenges).values({
    userId,
    tokenHash: hashChallengeToken(token),
    attempts: 0,
    expiresAt,
    consumedAt: null,
  });
  return { token, expiresAt };
}

export type ChallengeRecord = {
  id: string;
  userId: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
};

export async function findChallenge(token: unknown): Promise<ChallengeRecord | null> {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
  const [row] = await db
    .select({
      id: twoFactorChallenges.id,
      userId: twoFactorChallenges.userId,
      attempts: twoFactorChallenges.attempts,
      expiresAt: twoFactorChallenges.expiresAt,
      consumedAt: twoFactorChallenges.consumedAt,
    })
    .from(twoFactorChallenges)
    .where(eq(twoFactorChallenges.tokenHash, hashChallengeToken(token)))
    .limit(1);
  return row ?? null;
}

export async function consumeChallenge(id: string): Promise<boolean> {
  const [row] = await db
    .update(twoFactorChallenges)
    .set({ consumedAt: new Date() })
    .where(and(eq(twoFactorChallenges.id, id), isNull(twoFactorChallenges.consumedAt)))
    .returning({ id: twoFactorChallenges.id });
  return Boolean(row);
}

/** Counts a failed attempt and kills the challenge at the ceiling. */
export async function failChallenge(id: string, attempts: number): Promise<void> {
  const next = attempts + 1;
  await db
    .update(twoFactorChallenges)
    .set({ attempts: next, ...(next >= MAX_CHALLENGE_ATTEMPTS ? { consumedAt: new Date() } : {}) })
    .where(eq(twoFactorChallenges.id, id));
}

/** Compares two already-hashed values without leaking timing. Kept for callers. */
export function hashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
