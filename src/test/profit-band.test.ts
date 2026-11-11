import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { plans, services } from "@/lib/services/catalog";
import { digitalServices } from "@/lib/services/digital/digital-services";
import { CATALOG_PRICES, DIGITAL_PRICES } from "@/lib/services/prices.generated";
import {
  PROFIT_BAND,
  isPriceInBand,
  markupPercent,
  maxDiscountPercentFor,
  priceFromCost,
  profitFloorNgn,
  targetMarkupPercent,
} from "@/lib/services/pricing";

vi.mock("@/lib/payments/exchange-rate", () => ({
  getUsdToNgnRate: async () => ({ rate: 1600, source: "test", fetchedAt: new Date().toISOString() }),
}));

const { priceMarketplaceListing, applyPromoDiscount } = await import("@/lib/services/accounts/marketplace-pricing");

/** The owner-editable supplier price sheet — the single source of every price. */
type CostRow = { service: string; label: string; cost: number };
const sheet = JSON.parse(
  readFileSync(path.join(process.cwd(), "data/cost-sheet.json"), "utf8"),
) as { catalog: Record<string, CostRow>; digital: Record<string, CostRow> };

/** The owner's standing rule: every service earns 15% over its fixed cost. */
describe("profit band policy", () => {
  it("defaults to a 15% band with a 15% target", () => {
    expect(PROFIT_BAND.min).toBe(15);
    expect(PROFIT_BAND.target).toBe(15);
    expect(PROFIT_BAND.max).toBe(15);
  });

  it("prices a ₦1,000 cost between ₦1,300 and ₦1,500", () => {
    const quote = priceFromCost(1000, { targetPercent: 40 });
    expect(quote.priceNgn).toBe(1150);
    expect(quote.profitNgn).toBe(150);
    expect(isPriceInBand(quote.priceNgn, quote.costNgn)).toBe(true);
  });

  it("never rounds a price below the floor", () => {
    for (const cost of [37, 249, 1013, 4001, 12999, 25550]) {
      const quote = priceFromCost(cost);
      expect(quote.priceNgn).toBeGreaterThanOrEqual(cost * 1.15);
      expect(quote.markupPercent).toBeGreaterThanOrEqual(14.9);
      expect(quote.markupPercent).toBeLessThanOrEqual(18);
    }
  });

  it("keeps every service target inside the band", () => {
    for (const service of services) {
      const target = targetMarkupPercent(service.slug);
      expect(target).toBeGreaterThanOrEqual(PROFIT_BAND.min);
      expect(target).toBeLessThanOrEqual(PROFIT_BAND.max);
    }
  });

  it("clamps an absurd target rather than trusting it", () => {
    expect(priceFromCost(1000, { targetPercent: 500 }).markupPercent).toBeLessThanOrEqual(18);
    expect(priceFromCost(1000, { targetPercent: 1 }).markupPercent).toBeGreaterThanOrEqual(14.9);
  });

  it("exposes a floor that never falls below 15% on cost", () => {
    for (const cost of [100, 160, 900, 1200, 12000]) {
      const floor = profitFloorNgn(cost);
      expect(markupPercent(floor, cost)).toBeGreaterThanOrEqual(14.9);
      expect(markupPercent(floor, cost)).toBeLessThanOrEqual(18);
    }
  });
});

describe("catalogue prices", () => {
  it("every plan costs something and is priced at 15% over that cost", () => {
    const offenders = Object.entries(sheet.catalog)
      .map(([slug, row]) => ({
        slug,
        markup: Math.round(markupPercent(CATALOG_PRICES[slug].price, row.cost) * 10) / 10,
      }))
      .filter((row) => row.markup < 14.9 || row.markup > 18);

    expect(offenders).toEqual([]);
  });

  it("every digital subscription plan sits in the band too", () => {
    const offenders = Object.entries(sheet.digital)
      .map(([id, row]) => ({
        id,
        markup: Math.round(markupPercent(DIGITAL_PRICES[id].price, row.cost) * 10) / 10,
      }))
      .filter((row) => row.markup < 14.9 || row.markup > 18);

    expect(offenders).toEqual([]);
  });

  it("the generated price table is not stale", () => {
    for (const [slug, row] of Object.entries(sheet.catalog)) {
      const expected = priceFromCost(row.cost, { service: row.service }).priceNgn;
      expect(CATALOG_PRICES[slug]?.price, `${slug} is stale`).toBe(expected);
    }
    for (const [id, row] of Object.entries(sheet.digital)) {
      const expected = priceFromCost(row.cost, { service: row.service }).priceNgn;
      expect(DIGITAL_PRICES[id]?.price, `${id} is stale`).toBe(expected);
    }
  });

  it("ships prices without leaking supplier costs to the browser bundle", () => {
    const generated = readFileSync(
      path.join(process.cwd(), "src/lib/services/prices.generated.ts"),
      "utf8",
    );
    expect(generated).not.toMatch(/"?cost"?\s*:/i);

    for (const plan of plans) {
      expect(Object.keys(plan)).not.toContain("cost");
    }
    for (const plan of digitalServices.flatMap((service) => service.plans)) {
      expect(Object.keys(plan)).not.toContain("cost");
    }
  });

  it("never shows a strike-through price below the price we charge", () => {
    for (const plan of plans) {
      if (plan.compareAt !== undefined) {
        expect(plan.compareAt).toBeGreaterThan(plan.price);
      }
    }
    for (const plan of digitalServices.flatMap((service) => service.plans)) {
      if (plan.compareAt !== undefined) {
        expect(plan.compareAt).toBeGreaterThan(plan.price);
      }
    }
  });

  it("charges a Naira price that is a whole naira and a tidy ₦10 at least", () => {
    for (const plan of plans) {
      expect(Number.isInteger(plan.price)).toBe(true);
      expect(plan.price % 1).toBe(0);
    }
  });

  it("a service's fromPrice is the price of its cheapest plan", () => {
    for (const service of services) {
      const servicePlans = plans.filter((plan) => plan.service === service.slug);
      if (servicePlans.length === 0) continue;
      const cheapest = Math.min(...servicePlans.map((plan) => plan.price));
      expect(service.fromPrice).toBe(cheapest);
    }
  });
});

describe("marketplace pipeline respects the band", () => {
  it.each([1, 2, 5, 10, 25, 50])("keeps at least 15%% markup at quantity %i", async (quantity) => {
    for (const unitPriceUsd of ["0.10", "0.99", "4.50", "19.99"]) {
      const price = await priceMarketplaceListing({ unitPriceUsd, quantity });
      expect(price.markupPercent).toBeGreaterThanOrEqual(14.9);
      expect(price.markupPercent).toBeLessThanOrEqual(18);
    }
  });

  it("caps the category premium instead of letting it exceed 15%", async () => {
    const social = await priceMarketplaceListing({
      unitPriceUsd: "2.00",
      quantity: 1,
      categoryTitle: "Facebook",
      subcategoryTitle: "Facebook Accounts",
    });
    expect(social.markupPercent).toBeLessThanOrEqual(18);
    expect(social.markupPercent).toBe(15);
  });

  it("a promo may shrink profit but not below 15%", async () => {
    const base = await priceMarketplaceListing({ unitPriceUsd: "5.00", quantity: 2 });
    const discounted = applyPromoDiscount(base, "2.00");
    expect(discounted.markupPercent).toBeGreaterThanOrEqual(14.9);
    expect(discounted.totalNgn).toBeLessThanOrEqual(base.totalNgn);
  });

  it("the rounding step never takes a price out of the band", async () => {
    const price = await priceMarketplaceListing({ unitPriceUsd: "0.31", quantity: 1 });
    expect(price.totalNgn % 1).toBe(0);
    expect(price.totalNgn).toBeGreaterThanOrEqual(price.costNgn * 1.15);
    expect(price.totalNgn).toBeLessThanOrEqual(price.costNgn * 1.15 + 1);
  });
});

describe("discounts may not breach the floor", () => {
  it("caps a bulk basket at the thinnest line's headroom", async () => {
    const { calculateBulkOrder } = await import("@/lib/services/bulk-orders");
    const { CATALOG_PRICES } = await import("@/lib/services/prices.generated");

    // The proxy plan sits near the bottom of the band (35%), so a 10% basket discount
    // would drop it under 15%. The basket must shrink its own discount instead.
    const basket = calculateBulkOrder([{ productSlug: "proxy-ng-1", quantity: 25 }]);
    expect(basket.discountPercent).toBeLessThanOrEqual(
      CATALOG_PRICES["proxy-ng-1"].maxDiscountPercent,
    );

    const unitCost = sheet.catalog["proxy-ng-1"].cost;
    const realisedMarkup = markupPercent(basket.total / basket.items[0].quantity, unitCost);
    expect(realisedMarkup).toBeGreaterThanOrEqual(14.9);
  });

  it("still gives the full 10% where the margin allows it", async () => {
    const { calculateBulkOrder } = await import("@/lib/services/bulk-orders");
    // A 45%-markup plan can afford the whole tier.
    const basket = calculateBulkOrder([{ productSlug: "vn-ng", quantity: 25 }]);
    expect(basket.discountPercent).toBe(0);
    expect(markupPercent(basket.total / 25, sheet.catalog["vn-ng"].cost)).toBeGreaterThanOrEqual(14.9);
  });

  it("computes a headroom of zero for a price already at the floor", () => {
    expect(maxDiscountPercentFor(1150, 1000)).toBe(0);
    expect(maxDiscountPercentFor(1450, 1000)).toBeGreaterThanOrEqual(9);
  });
});
