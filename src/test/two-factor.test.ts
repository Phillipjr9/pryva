import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { twoFactorChallenges, twoFactorRecoveryCodes, userTwoFactor } from "@/db/schema";
import { totpAt, currentStep } from "@/lib/totp";
import {
  MAX_CHALLENGE_ATTEMPTS,
  beginEnrolment,
  confirmEnrolment,
  consumeChallenge,
  createChallenge,
  disableTwoFactor,
  encryptSecret,
  decryptSecret,
  findChallenge,
  getEnrolment,
  remainingRecoveryCodes,
  twoFactorAvailable,
  verifySecondFactor,
} from "@/lib/two-factor";

/**
 * A second factor is only worth having if every "I could not check it" path
 * denies access. These tests pin the three that matter:
 *
 *   * the secret is unreadable without the key, and a tampered blob fails;
 *   * a code cannot be replayed, and a recovery code is spent once;
 *   * an account with 2FA enabled reports "unavailable" rather than "not
 *     required" when the key is missing, so sign-in fails closed.
 */

const KEY = "test-two-factor-key-0123456789";
const userId = "5c8f0d9a-3f6b-4c1e-9a2d-7b1e2f3a4c5d";

beforeEach(async () => {
  vi.stubEnv("TWO_FACTOR_KEY", KEY);
  // The preview adapter keeps one process-wide store, so this file clears the
  // rows it owns between tests instead of relying on isolation between them.
  await db.delete(twoFactorChallenges).where(eq(twoFactorChallenges.userId, userId));
  await db.delete(twoFactorRecoveryCodes).where(eq(twoFactorRecoveryCodes.userId, userId));
  await db.delete(userTwoFactor).where(eq(userTwoFactor.userId, userId));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("two-factor encryption", () => {
  it("round-trips a secret and does not store it in plaintext", () => {
    const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    const ciphertext = encryptSecret(secret);
    expect(ciphertext).not.toContain(secret);
    expect(ciphertext.startsWith("v1.")).toBe(true);
    expect(decryptSecret(ciphertext)).toBe(secret);
  });

  it("refuses a tampered ciphertext instead of returning garbage", () => {
    const ciphertext = encryptSecret("JBSWY3DPEHPK3PXP");
    const parts = ciphertext.split(".");
    const flipped = parts[3][2] === "A" ? "B" : "A";
    parts[3] = `${parts[3].slice(0, 2)}${flipped}${parts[3].slice(3)}`;
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("is unavailable, never degraded, when the key is missing", () => {
    vi.stubEnv("TWO_FACTOR_KEY", "");
    expect(twoFactorAvailable()).toBe(false);
    expect(() => encryptSecret("JBSWY3DPEHPK3PXP")).toThrow();
  });

  it("refuses a key that is too short to be a passphrase", () => {
    vi.stubEnv("TWO_FACTOR_KEY", "short");
    expect(twoFactorAvailable()).toBe(false);
  });
});

describe("enrolment lifecycle (in-memory database)", () => {
  async function enrol() {
    const started = await beginEnrolment(userId, "ada@pryva.ng");
    if (!started.ok) throw new Error("enrolment refused");
    const code = totpAt(started.secret, currentStep());
    const confirmed = await confirmEnrolment(userId, code);
    if (!confirmed.ok) throw new Error("confirmation refused");
    return { secret: started.secret, code, recoveryCodes: confirmed.recoveryCodes };
  }

  it("stores the secret encrypted and only enables after a correct code", async () => {
    const started = await beginEnrolment(userId, "ada@pryva.ng");
    expect(started.ok).toBe(true);

    const [stored] = await db
      .select()
      .from(userTwoFactor)
      .where(eq(userTwoFactor.userId, userId))
      .limit(1);
    expect(stored.secretCiphertext).not.toContain(started.ok ? started.secret : "");
    expect(stored.enabledAt).toBeNull();

    const wrong = await confirmEnrolment(userId, "12345");
    expect(wrong.ok).toBe(false);

    if (!started.ok) throw new Error("unreachable");
    const confirmed = await confirmEnrolment(userId, totpAt(started.secret, currentStep()));
    expect(confirmed.ok).toBe(true);
    expect(confirmed.ok && confirmed.recoveryCodes).toHaveLength(10);

    const [enabled] = await db
      .select()
      .from(userTwoFactor)
      .where(eq(userTwoFactor.userId, userId))
      .limit(1);
    expect(enabled.enabledAt).toBeInstanceOf(Date);
  });

  it("does not let a second attempt replace an enabled enrolment", async () => {
    await enrol();
    const again = await beginEnrolment(userId, "ada@pryva.ng");
    expect(again).toEqual({ ok: false, reason: "already-enabled" });
  });

  it("accepts a code once and refuses the replay inside its window", async () => {
    const { secret } = await enrol();
    // Confirming enrolment spends the current time-step, so a sign-in uses the
    // next window's code — the same thing a real user sees if they sign in
    // immediately after switching 2FA on.
    const code = totpAt(secret, currentStep() + 1);
    const first = await verifySecondFactor(userId, code);
    expect(first).toEqual({ ok: true, method: "totp" });
    const replay = await verifySecondFactor(userId, code);
    expect(replay).toEqual({ ok: false, reason: "invalid" });
  });

  it("does not let the code that confirmed enrolment become a sign-in code", async () => {
    const { code } = await enrol();
    expect(await verifySecondFactor(userId, code)).toEqual({ ok: false, reason: "invalid" });
  });

  it("spends a recovery code exactly once", async () => {
    const { recoveryCodes } = await enrol();
    expect(await remainingRecoveryCodes(userId)).toBe(10);

    const first = await verifySecondFactor(userId, recoveryCodes[0]);
    expect(first).toEqual({ ok: true, method: "recovery" });
    expect(await remainingRecoveryCodes(userId)).toBe(9);

    const second = await verifySecondFactor(userId, recoveryCodes[0]);
    expect(second).toEqual({ ok: false, reason: "invalid" });
  });

  it("reports unavailable, not not-enabled, when the key is missing", async () => {
    await enrol();
    vi.stubEnv("TWO_FACTOR_KEY", "");
    expect(await verifySecondFactor(userId, "123456")).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("clears the secret, recovery codes and challenges on disable", async () => {
    await enrol();
    await createChallenge(userId);
    await disableTwoFactor(userId);

    expect(await getEnrolment(userId)).toBeNull();
    expect(await remainingRecoveryCodes(userId)).toBe(0);
    const challenges = await db
      .select()
      .from(twoFactorChallenges)
      .where(eq(twoFactorChallenges.userId, userId));
    expect(challenges).toHaveLength(0);
    const codes = await db
      .select()
      .from(twoFactorRecoveryCodes)
      .where(eq(twoFactorRecoveryCodes.userId, userId));
    expect(codes).toHaveLength(0);
  });
});

describe("sign-in challenges", () => {
  it("stores only a hash, finds by the token and can be consumed once", async () => {
    const { token } = await createChallenge(userId);
    const found = await findChallenge(token);
    expect(found?.userId).toBe(userId);
    expect(found?.attempts).toBe(0);

    const [row] = await db
      .select()
      .from(twoFactorChallenges)
      .where(eq(twoFactorChallenges.userId, userId))
      .limit(1);
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toHaveLength(64);

    expect(await consumeChallenge(found!.id)).toBe(true);
    expect(await consumeChallenge(found!.id)).toBe(false);
  });

  it("rejects an unknown or malformed token without touching the database", async () => {
    expect(await findChallenge("short")).toBeNull();
    expect(await findChallenge("x".repeat(43))).toBeNull();
    expect(await findChallenge(null)).toBeNull();
  });

  it("documents the attempt ceiling the route enforces", () => {
    expect(MAX_CHALLENGE_ATTEMPTS).toBe(5);
  });
});
