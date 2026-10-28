import { afterEach, describe, expect, it, vi } from "vitest";
import { giftCardAttemptLimit, normalizeGiftCardCode } from "@/lib/gift-card-requests";
import { generateCode } from "@/lib/gift-cards";

afterEach(() => vi.unstubAllEnvs());

describe("gift card bearer-code protections", () => {
  it("accepts generated codes case-insensitively but rejects malformed or oversized input", () => {
    const code = generateCode();
    expect(normalizeGiftCardCode(` ${code.toLowerCase()} `)).toBe(code);
    for (const invalid of [null, "PRYVA-1234-XXXX-XXXX", "anything", "x".repeat(5000)]) {
      expect(normalizeGiftCardCode(invalid)).toBeNull();
    }
  });
  it("shares one attempt budget across checks and redemptions", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const request = new Request("https://pryva.test/api/gift-cards/check", {
      method: "POST", headers: { "x-forwarded-for": "198.51.100.201" },
    });
    for (let i = 0; i < 15; i++) {
      await expect(giftCardAttemptLimit(request, "gift-rate-user-1")).resolves.toBeNull();
    }
    expect((await giftCardAttemptLimit(request, "gift-rate-user-1"))?.status).toBe(429);
    // A second account has its own account budget but still consumes the IP budget.
    await expect(giftCardAttemptLimit(request, "gift-rate-user-2")).resolves.toBeNull();
  });
});
