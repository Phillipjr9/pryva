import { describe, expect, it } from "vitest";
import { forgetPaystackTopUp, readPendingPaystackTopUps, rememberPaystackTopUp } from "@/lib/paystack-topup-intent";
import { paystackAppOrigin } from "@/lib/paystack-origin";

function storage(): Storage {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, clear: () => values.clear(), getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null, removeItem: (key) => { values.delete(key); }, setItem: (key, value) => { values.set(key, value); } };
}
const a = { reference: "TOP-aaaaaaaaaaaaaaaaaaaaaaaa", amount: 2000 };
const b = { reference: "TOP-bbbbbbbbbbbbbbbbbbbbbbbb", amount: 5000 };

describe("Paystack recovery references", () => {
  it("keeps independent references per user and per tab without storing the checkout URL", () => {
    const saved = storage();
    rememberPaystackTopUp(saved, "one", a);
    rememberPaystackTopUp(saved, "one", b);
    rememberPaystackTopUp(saved, "two", a);
    expect(readPendingPaystackTopUps(saved, "one")).toEqual([a, b]);
    expect(saved.getItem(`pryva.topup.pending.v1.one.${a.reference}`)).not.toContain("checkout");
    forgetPaystackTopUp(saved, "one", a.reference);
    expect(readPendingPaystackTopUps(saved, "one")).toEqual([b]);
    expect(readPendingPaystackTopUps(saved, "two")).toEqual([a]);
  });
  it("fails closed for corrupt, cross-key, and invalid saved values", () => {
    const saved = storage();
    expect(() => rememberPaystackTopUp(saved, "one", { ...a, amount: 1.5 })).toThrow();
    saved.setItem(`pryva.topup.pending.v1.one.${a.reference}`, JSON.stringify(b));
    expect(() => readPendingPaystackTopUps(saved, "one")).toThrow();
    expect(() => forgetPaystackTopUp(saved, "one", "../bad")).toThrow();
  });
});

describe("Paystack return origin", () => {
  it("accepts HTTPS origins and local HTTP only outside production", () => {
    expect(paystackAppOrigin("https://pryva.example/", false)).toBe("https://pryva.example");
    expect(paystackAppOrigin("http://localhost:3000", true)).toBe("http://localhost:3000");
    expect(paystackAppOrigin("http://localhost:3000", false)).toBeNull();
    for (const value of ["http://public.example", "https://user:pass@pryva.example", "https://pryva.example/path", "https://pryva.example/?query=1", "javascript:alert(1)"]) {
      expect(paystackAppOrigin(value, true)).toBeNull();
    }
  });
});
