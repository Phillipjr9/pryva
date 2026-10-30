import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  currentStep,
  generateTotpSecret,
  totpAt,
  totpUri,
  verifyTotp,
} from "@/lib/totp";

/**
 * RFC 6238 Appendix B vectors, SHA-1, truncated to the six digits every
 * authenticator app shows. If these fail, every phone in the world disagrees with
 * the server and nobody can sign in — which is why they are checked against the
 * published values rather than against this implementation's own output.
 *
 * The RFC's shared secret is the ASCII string "12345678901234567890".
 */
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("TOTP (RFC 6238)", () => {
  it("matches the published SHA-1 vectors", () => {
    const vectors: Array<[number, string]> = [
      [59, "287082"],
      [1111111109, "081804"],
      [1111111111, "050471"],
      [1234567890, "005924"],
      [2000000000, "279037"],
      [20000000000, "353130"],
    ];
    for (const [seconds, expected] of vectors) {
      expect(totpAt(RFC_SECRET, Math.floor(seconds / 30)), `t=${seconds}`).toBe(expected);
    }
  });

  it("accepts the current code and one step either side", () => {
    const step = currentStep();
    for (const delta of [-1, 0, 1]) {
      const code = totpAt(RFC_SECRET, step + delta);
      expect(verifyTotp(RFC_SECRET, code).ok, `delta ${delta}`).toBe(true);
    }
  });

  it("refuses a code from outside the window", () => {
    const code = totpAt(RFC_SECRET, currentStep() - 5);
    expect(verifyTotp(RFC_SECRET, code)).toEqual({ ok: false, reason: "no-match" });
  });

  it("refuses a code that has already been spent, even inside the window", () => {
    const step = currentStep();
    const code = totpAt(RFC_SECRET, step);
    const first = verifyTotp(RFC_SECRET, code, { rejectUpToStep: step - 1 });
    expect(first).toEqual({ ok: true, step });
    expect(verifyTotp(RFC_SECRET, code, { rejectUpToStep: step })).toEqual({
      ok: false,
      reason: "no-match",
    });
  });

  it("rejects malformed input without throwing", () => {
    for (const value of [null, undefined, 123456, "", "abcdef", "12345", "1234567"]) {
      expect(verifyTotp(RFC_SECRET, value as unknown)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("tolerates spaces, which people paste from authenticator apps", () => {
    const code = totpAt(RFC_SECRET, currentStep());
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verifyTotp(RFC_SECRET, spaced).ok).toBe(true);
  });

  it("round-trips base32 and rejects characters outside the alphabet", () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    expect(() => base32Decode("INVALID!")).toThrow();
  });

  it("generates a 32-character secret and a scannable URI", () => {
    const secret = generateTotpSecret();
    expect(secret).toHaveLength(32);
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    const uri = totpUri(secret, "ada@pryva.ng");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain("issuer=Pryva");
  });
});
