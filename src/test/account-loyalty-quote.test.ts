import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/payments/exchange-rate", () => ({
  getUsdToNgnRate: async () => ({ rate: 1600, source: "test" }),
}));

import { applyPromoDiscount, priceMarketplaceListing } from "@/lib/services/accounts/marketplace-pricing";
import { compareAccountDiscounts } from "@/lib/services/accounts/loyalty-quote";

// Synthetic headroom exercises selection even though the current production
// target and floor are both 15%, so loyalty usually cannot reduce the price.
async function withHeadroom(volume = 1400) {
  const actual = await priceMarketplaceListing({ unitPriceUsd: "0.625", quantity: 1 });
  return { ...actual, exactCostNgn: 1000, undiscountedTotalNgn: 1500, totalNgn: volume };
}

describe("dormant account discount comparison", () => {
  it("compares volume and loyalty independently and chooses volume", async () => {
    const quote = compareAccountDiscounts({ price: await withHeadroom(), eligibleOrders: 60 });
    expect(quote.candidates).toEqual({ volumeNgn: 1400, loyaltyNgn: 1470, promoNgn: null });
    expect(quote).toMatchObject({ winner: "volume", totalNgn: 1400, savedNgn: 100, submitPromo: false });
  });

  it("chooses loyalty over a weaker volume discount", async () => {
    const quote = compareAccountDiscounts({ price: await withHeadroom(1499), eligibleOrders: 60 });
    expect(quote).toMatchObject({ winner: "loyalty", totalNgn: 1470, loyaltyLevel: 5, loyaltyBasisPoints: 200 });
  });

  it("compares a promo against the undiscounted amount, with a separate supplier cost floor", async () => {
    const quote = compareAccountDiscounts({ price: await withHeadroom(), eligibleOrders: 60, validatedPromoDiscountUsd: "0.20" });
    expect(quote.candidates).toEqual({ volumeNgn: 1400, loyaltyNgn: 1470, promoNgn: 1180 });
    expect(quote.floors.normalNgn).toBe(1150);
    expect(quote.floors.promoNgn).toBe(782);
    expect(quote).toMatchObject({ winner: "promo", totalNgn: 1180, submitPromo: true });
  });

  it("does not submit the promo on a tie", async () => {
    const quote = compareAccountDiscounts({ price: await withHeadroom(1180), eligibleOrders: 60, validatedPromoDiscountUsd: "0.20" });
    expect(quote).toMatchObject({ winner: "volume", totalNgn: 1180, submitPromo: false });
  });

  it("caps loyalty at the normal floor and oversized promo at the minimum charge", async () => {
    const price = { ...(await withHeadroom(1160)), undiscountedTotalNgn: 1160 };
    const loyalty = compareAccountDiscounts({ price, eligibleOrders: 60 });
    expect(loyalty).toMatchObject({ winner: "loyalty", totalNgn: 1150 });
    const promo = compareAccountDiscounts({ price, eligibleOrders: 60, validatedPromoDiscountUsd: "99.00" });
    expect(promo).toMatchObject({ winner: "promo", totalNgn: 500, floors: { promoNgn: 500 } });
  });

  it("never creates headroom at the current 15% markup", async () => {
    const price = await priceMarketplaceListing({ unitPriceUsd: "3.480000", quantity: 25 });
    const quote = compareAccountDiscounts({ price, eligibleOrders: 60 });
    expect(quote.totalNgn).toBe(price.totalNgn);
    expect(quote.winner).toBe("none");
    expect(quote.totalNgn).toBeGreaterThanOrEqual(price.exactCostNgn * 1.15);
  });

  it("rounds fractional supplier discounts down even beyond six decimals", async () => {
    const quote = compareAccountDiscounts({ price: await withHeadroom(1500), eligibleOrders: 0, validatedPromoDiscountUsd: "0.009999999" });
    expect(quote).toMatchObject({ winner: "none", totalNgn: 1500, candidates: { promoNgn: 1500 } });
  });

  it("rejects unverified counts, prices, promos and subminimum baskets", async () => {
    const price = await withHeadroom();
    for (const eligibleOrders of [-1, NaN, 1.5]) {
      expect(() => compareAccountDiscounts({ price, eligibleOrders })).toThrow();
    }
    for (const validatedPromoDiscountUsd of ["-0.001", "oops", "1000001"]) {
      expect(() => compareAccountDiscounts({ price, eligibleOrders: 0, validatedPromoDiscountUsd })).toThrow();
    }
    expect(() => compareAccountDiscounts({ price: { ...price, totalNgn: 1100 }, eligibleOrders: 0 })).toThrow();
    expect(() => compareAccountDiscounts({ price: { ...price, exactFxRate: NaN }, eligibleOrders: 0 })).toThrow();
    const adjusted = applyPromoDiscount(price, "0.20");
    expect(() => compareAccountDiscounts({ price: adjusted, eligibleOrders: 60 })).toThrow();
    const cheap = await priceMarketplaceListing({ unitPriceUsd: "0.05", quantity: 1 });
    expect(() => compareAccountDiscounts({ price: cheap, eligibleOrders: 60, validatedPromoDiscountUsd: "0.05" })).toThrow();
  });
});
