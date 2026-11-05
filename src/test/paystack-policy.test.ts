import { describe, expect, it } from "vitest";
import { paystackKeyUsable } from "@/lib/paystack-policy";

describe("Paystack production key policy", () => {
  it("allows only a nonempty live key in production", () => {
    const env = { VERCEL_ENV: "production", NODE_ENV: "production" as const };
    for (const key of [undefined, "", "sk_live_", "sk_test_example", "unrecognised"]) {
      expect(paystackKeyUsable(key, env)).toBe(false);
    }
    expect(paystackKeyUsable("sk_live_example", env)).toBe(true);
  });

  it("also protects non-Vercel production and permits isolated development tests", () => {
    expect(paystackKeyUsable("sk_test_example", { NODE_ENV: "production" })).toBe(false);
    expect(paystackKeyUsable("sk_test_example", { NODE_ENV: "test" })).toBe(true);
    expect(paystackKeyUsable("sk_test_example", { NODE_ENV: "production", VERCEL_ENV: "preview" })).toBe(true);
    // The separate financial environment guard blocks preview operations entirely.
  });
});
