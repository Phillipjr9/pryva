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

  /**
   * Regression: the routing layer normalises every source price to a canonical
   * six-decimal string (`usdStringFromMicros`), and this module used to parse it
   * with the legacy two-decimal parser, which threw `bad_money_value` on
   * "3.480000". Every listing from both API sources 500'd as a result — and no
   * test caught it, because the route tests mock this module and this file only
   * ever used two-decimal literals.
   */
  it("prices the canonical six-decimal string the routing layer actually produces", async () => {
    const price = await priceMarketplaceListing({ unitPriceUsd: "3.480000", quantity: 1 });

    expect(price.costNgn).toBe(5568); // $3.48 × 1600
    expect(price.totalNgn).toBeGreaterThan(price.costNgn);
    expect(price.profitNgn).toBeGreaterThanOrEqual(200);
  });

  it("prices a sub-cent price instead of rejecting it", async () => {
    // A real published price carries five decimals; the cost rounds up to a
    // whole cent, which can only raise the margin floor.
    const price = await priceMarketplaceListing({ unitPriceUsd: "0.069920", quantity: 1 });

    expect(price.costNgn).toBe(112); // 7 cents × 1600
    expect(price.totalNgn).toBeGreaterThan(0);
  });

  it("prices every realistic value a source can round-trip through the money parser", async () => {
    const { usdMicros, usdStringFromMicros } = await import("@/lib/supplier-money");
    for (const raw of [3.48, 0.06992, 1, 0.5, 19.99, 12.345678, 0.05, 250]) {
      const canonical = usdStringFromMicros(usdMicros(raw));
      const price = await priceMarketplaceListing({ unitPriceUsd: canonical, quantity: 2 });
      expect(price.totalNgn, `${raw} → ${canonical}`).toBeGreaterThan(0);
      expect(price.markupPercent, `${raw} → ${canonical}`).toBeGreaterThanOrEqual(30);
      expect(price.markupPercent, `${raw} → ${canonical}`).toBeLessThanOrEqual(50);
    }
  });

  it("prices an absurdly cheap item instead of throwing, and leaves the minimum to checkout", async () => {
    // One micro-dollar costs ₦16. Pricing still returns a quote rather than
    // throwing: refusing a basket below the ₦500 minimum is the purchase route's
    // job, so the shopper is told to add units at checkout instead of getting a
    // 502 on the whole listing page.
    //
    // The band ceiling cannot hold for a single unit and that is arithmetic, not
    // a bug: the ₦10 rounding step is larger than the 50% headroom on a ₦16 cost,
    // so any price rounded to the step lands above the ceiling.
    const price = await priceMarketplaceListing({ unitPriceUsd: "0.000001", quantity: 1 });
    expect(price.costNgn).toBe(16);
    expect(price.totalNgn).toBe(30);
    expect(price.profitNgn).toBe(14);
    expect(price.totalNgn).toBeLessThan(500); // checkout is what rejects this

    // Once the cost is big enough for the step to stop dominating, the band
    // holds again: 20 units cost ₦320 and price at exactly the 50% ceiling.
    const basket = await priceMarketplaceListing({ unitPriceUsd: "0.000001", quantity: 20 });
    expect(basket.costNgn).toBe(320);
    expect(basket.totalNgn).toBe(480);
    expect(basket.markupPercent).toBeLessThanOrEqual(50);
    expect(basket.profitNgn).toBe(160);
  });

  it("rounds a cost up and a discount down, so neither moves money our way", async () => {
    const { usdCents } = await import("@/lib/supplier-money");
    // A fraction of a cent of cost rounds up (margin floor can only rise)...
    expect(usdCents("0.069920")).toBe(7);
    // ...and the same fraction of a discount rounds down (never over-credited).
    expect(usdCents("0.069920", "down")).toBe(6);

    const base = await priceMarketplaceListing({ unitPriceUsd: "3.480000", quantity: 1 });
    const discounted = applyPromoDiscount(base, "0.000001");
    // A sub-cent discount cannot inflate into a whole naira reduction.
    expect(discounted.totalNgn).toBeLessThanOrEqual(base.totalNgn);
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
