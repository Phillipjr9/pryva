import { createHmac } from "node:crypto";
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("Paystack webhook signature", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("rejects every webhook when no secret key is configured", async () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    const { verifyWebhookSignature } = await import("@/lib/paystack");

    // An empty key would let anyone compute a valid HMAC, so it must fail closed.
    expect(verifyWebhookSignature("{}", "anything")).toBe(false);
    expect(verifyWebhookSignature("{}", null)).toBe(false);
  });

  it("accepts a body signed with the configured secret", async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_secret";
    const { verifyWebhookSignature } = await import("@/lib/paystack");

    const body = JSON.stringify({ event: "charge.success", data: { reference: "TOPUP-1" } });
    const signature = createHmac("sha512", "sk_test_secret").update(body).digest("hex");

    expect(verifyWebhookSignature(body, signature)).toBe(true);
    expect(verifyWebhookSignature(body, null)).toBe(false);
    expect(verifyWebhookSignature(`${body} `, signature)).toBe(false);
    expect(verifyWebhookSignature(body, "0".repeat(signature.length))).toBe(false);
  });
});
