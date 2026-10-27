import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/exchange-rate", () => ({
  getUsdToNgnRate: async () => ({ rate: 1600, source: "test", fetchedAt: new Date().toISOString() }),
}));

const { priceMarketplaceListing, applyPromoDiscount } = await import("@/lib/marketplace-pricing");

describe("marketplace pricing", () => {
  beforeEach(() => {
    vi.stubEnv("MARKETPLACE_BASE_MARKUP_PERCENT", "");
    vi.stubEnv("MARKETPLACE_MIN_PROFIT_NGN", "");
  });

  it("never sells at cost — a $1 listing carries markup", async () => {
    const price = await priceMarketplaceListing({ unitPriceUsd: "1.00", quantity: 1 });

    expect(price.costNgn).toBe(1600);
    expect(price.totalNgn).toBeGreaterThan(price.costNgn);
    expect(price.profitNgn).toBeGreaterThanOrEqual(200);
  });

  it("applies the ₦200 minimum profit floor to very cheap listings", async () => {
    const price = await priceMarketplaceListing({ unitPriceUsd: "0.05", quantity: 1 });

    expect(price.costNgn).toBe(80);
    expect(price.profitNgn).toBeGreaterThanOrEqual(200);
  });

  it("adds a larger premium for Facebook and Instagram", async () => {
    const plain = await priceMarketplaceListing({ unitPriceUsd: "1.00", quantity: 1 });
    const social = await priceMarketplaceListing({
      unitPriceUsd: "1.00",
      quantity: 1,
      categoryTitle: "Facebook",
    });

    expect(social.markupPercent).toBeGreaterThan(plain.markupPercent);
    expect(social.totalNgn).toBeGreaterThan(plain.totalNgn);
  });

  it("discounts volume but keeps the basket profitable", async () => {
    const single = await priceMarketplaceListing({ unitPriceUsd: "1.00", quantity: 1 });
    const bulk = await priceMarketplaceListing({ unitPriceUsd: "1.00", quantity: 25 });

    expect(bulk.discountPercent).toBe(10);
    expect(bulk.totalNgn / 25).toBeLessThan(single.totalNgn);
    expect(bulk.profitNgn).toBeGreaterThanOrEqual(200);
  });

  it("rounds totals to a tidy ₦50 boundary", async () => {
    const price = await priceMarketplaceListing({ unitPriceUsd: "0.37", quantity: 3 });
    expect(price.totalNgn % 50).toBe(0);
  });

  it("handles zero quantity safely by treating it as one unit", async () => {
    const price = await priceMarketplaceListing({ unitPriceUsd: "2.00", quantity: 0 });
    expect(price.quantity).toBe(1);
  });

  it("passes a promo discount through without dropping below the floor", async () => {
    const base = await priceMarketplaceListing({ unitPriceUsd: "1.00", quantity: 1 });
    const discounted = applyPromoDiscount(base, "0.50");

    expect(discounted.totalNgn).toBeLessThan(base.totalNgn);
    expect(discounted.profitNgn).toBeGreaterThanOrEqual(200);
  });

  it("ignores an oversized promo discount instead of going negative", async () => {
    const base = await priceMarketplaceListing({ unitPriceUsd: "1.00", quantity: 1 });
    const discounted = applyPromoDiscount(base, "99.00");

    expect(discounted.totalNgn).toBeGreaterThanOrEqual(discounted.costNgn + 200);
    expect(discounted.totalNgn).toBeGreaterThan(0);
  });
});
