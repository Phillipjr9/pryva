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

  it("keeps a micro-listing at the band ceiling when ₦200 would breach it", async () => {
    const price = await priceMarketplaceListing({ unitPriceUsd: "0.05", quantity: 1 });

    expect(price.costNgn).toBe(80);
    expect(price.markupPercent).toBeLessThanOrEqual(50);
    expect(price.markupPercent).toBeGreaterThanOrEqual(30);
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

  it("rounds to the step that fits the cost", async () => {
    const cheap = await priceMarketplaceListing({ unitPriceUsd: "0.37", quantity: 3 });
    expect(cheap.totalNgn % 10).toBe(0);

    const expensive = await priceMarketplaceListing({ unitPriceUsd: "19.99", quantity: 2 });
    expect(expensive.totalNgn % 50).toBe(0);
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

  it("caps an oversized promo discount at the minimum chargeable order", async () => {
    const base = await priceMarketplaceListing({ unitPriceUsd: "1.00", quantity: 1 });
    const discounted = applyPromoDiscount(base, "99.00");

    expect(discounted.totalNgn).toBeGreaterThanOrEqual(500);
    expect(discounted.totalNgn).toBeLessThanOrEqual(base.totalNgn);
    expect(discounted.profitNgn).toBeGreaterThanOrEqual(0);
  });
});
