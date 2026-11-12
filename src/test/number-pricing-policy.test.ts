import { afterEach, expect, it, vi } from "vitest";
import { priceFromCost, targetMarkupPercent } from "@/lib/services/pricing";
afterEach(() => vi.unstubAllEnvs());
it("prices numbers at the temporary 15% markup even with legacy global configuration", () => {
  vi.stubEnv("PRICING_MIN_MARKUP_PERCENT", "30");
  vi.stubEnv("PRICING_TARGET_MARKUP_PERCENT", "40");
  vi.stubEnv("PRICING_MAX_MARKUP_PERCENT", "50");
  expect(targetMarkupPercent("numbers")).toBe(15);
  expect(priceFromCost(1000, { service: "numbers" }).priceNgn).toBe(1150);
  expect(priceFromCost(100, { service: "numbers" }).priceNgn).toBe(115);
  expect(priceFromCost(101, { service: "numbers" }).priceNgn).toBe(117);
  expect(priceFromCost(1000, { service: "accounts" }).priceNgn).toBe(1150);
});

it("applies the same 15% policy to every paid service target", () => {
  for (const service of ["numbers", "esim", "proxies", "accounts", "digital", "data", "gift-cards", "bulk", "scheduled", "airtime", "social", "subscriptions", "games", "topups", "prepaid"]) {
    expect(targetMarkupPercent(service)).toBe(15);
    expect(priceFromCost(1000, { service }).priceNgn).toBe(1150);
    expect(priceFromCost(101, { service }).priceNgn).toBe(117);
  }
});
