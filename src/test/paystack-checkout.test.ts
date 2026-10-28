import { describe, expect, it } from "vitest";
import { isSafePaystackCheckoutUrl } from "@/lib/paystack-checkout";

describe("Paystack checkout destinations", () => {
  it("allows only HTTPS URLs on the documented checkout host", () => {
    expect(isSafePaystackCheckoutUrl("https://checkout.paystack.com/abc?ref=1")).toBe(true);
    for (const value of [
      "http://checkout.paystack.com/abc", "https://checkout.paystack.com.evil.test/abc",
      "https://evil.test@checkout.paystack.com/abc", "https://checkout.paystack.com:444/abc",
      "javascript:alert(1)", "//checkout.paystack.com/abc", "not a url", null,
    ]) expect(isSafePaystackCheckoutUrl(value)).toBe(false);
  });
});
