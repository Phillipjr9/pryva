import { describe, expect, it } from "vitest";
import { BOOST_RETAIL_CEILING_PER_THOUSAND, boostRetailIsSane, retailPerThousand, smmMarkupPercent, totalForQuantity, normalizeCurrency } from "@/lib/services/boosts/smm-pricing";

/**
 * Retail pricing for boosting.
 *
 * The rule that matters: a price is only produced when it can be computed
 * honestly. A USD-billed supplier without a configured naira rate has no price
 * at all, because the alternative is inventing an exchange rate and losing money
 * on every order.
 */

const env = (overrides: Record<string, string> = {}) => overrides as unknown as NodeJS.ProcessEnv;

describe("markup", () => {
  it("defaults to 35% and refuses a nonsense value", () => {
    expect(smmMarkupPercent(env())).toBe(35);
    expect(smmMarkupPercent(env({ SMM_MARKUP_PERCENT: "50" }))).toBe(50);
    expect(smmMarkupPercent(env({ SMM_MARKUP_PERCENT: "abc" }))).toBe(35);
    expect(smmMarkupPercent(env({ SMM_MARKUP_PERCENT: "-10" }))).toBe(0);
    expect(smmMarkupPercent(env({ SMM_MARKUP_PERCENT: "9999" }))).toBe(400);
  });
});

describe("currency", () => {
  it("reads the currency the panel reports and nothing else", () => {
    expect(normalizeCurrency("NGN")).toBe("NGN");
    expect(normalizeCurrency("usd")).toBe("USD");
    expect(normalizeCurrency("USD ")).toBe("USD");
    expect(normalizeCurrency("EUR" as never)).toBeNull();
    expect(normalizeCurrency(null)).toBeNull();
  });
});

describe("retail price per 1,000", () => {
  it("applies the margin to an NGN rate and rounds up", () => {
    // 1,000 wholesale at 35% = 1,350 exactly.
    expect(retailPerThousand({ wholesaleRatePerThousand: 1_000, currency: "NGN", env: env() })).toBe(1_350);
    // 501 at 35% = 676.35, rounded up so never below cost.
    expect(retailPerThousand({ wholesaleRatePerThousand: 501, currency: "NGN", env: env() })).toBe(677);
  });

  it("converts a USD rate only when a rate is configured", () => {
    const rate = { wholesaleRatePerThousand: 0.74, currency: "USD", env: env() };
    expect(retailPerThousand(rate)).toBeNull();
    expect(retailPerThousand({ ...rate, env: env({ SMM_USD_NGN_RATE: "1600" }) })).toBe(1_599);
    // 0.74 * 1600 * 1.35 = 1598.4 -> 1599
  });

  it("refuses to price what it cannot price", () => {
    expect(retailPerThousand({ wholesaleRatePerThousand: null, currency: "NGN", env: env() })).toBeNull();
    expect(retailPerThousand({ wholesaleRatePerThousand: 0, currency: "NGN", env: env() })).toBeNull();
    expect(retailPerThousand({ wholesaleRatePerThousand: 100, currency: null, env: env() })).toBeNull();
  });
});

describe("the plausibility band", () => {
  it("rejects a price that is wrong by an order of magnitude", () => {
    // The realistic mistakes: a naira rate read as dollars (1400x high), or the
    // fx figure applied twice. Both land far above the ceiling.
    expect(boostRetailIsSane(1_399)).toBe(true);
    expect(boostRetailIsSane(75_000)).toBe(true);
    expect(boostRetailIsSane(BOOST_RETAIL_CEILING_PER_THOUSAND)).toBe(true);
    expect(boostRetailIsSane(BOOST_RETAIL_CEILING_PER_THOUSAND + 1)).toBe(false);
    expect(boostRetailIsSane(0)).toBe(false);
    expect(boostRetailIsSane(-5)).toBe(false);
    expect(boostRetailIsSane(null)).toBe(false);
    expect(boostRetailIsSane(Number.NaN)).toBe(false);
  });

  it("catches the two-currency mix-ups that produce a wrong price", () => {
    // A $0.74 rate at ₦1,400/$ and a 35% margin is ₦1,399 per thousand: fine.
    expect(boostRetailIsSane(retailPerThousand({ wholesaleRatePerThousand: 0.74, currency: "USD", env: env({ SMM_USD_NGN_RATE: "1400" }) }))).toBe(true);
    // The same panel read as if it billed naira per unit, then converted anyway.
    const nairaRate = retailPerThousand({ wholesaleRatePerThousand: 1_200, currency: "USD", env: env({ SMM_USD_NGN_RATE: "1400" }) });
    expect(nairaRate).toBe(2_268_000);
    expect(boostRetailIsSane(nairaRate)).toBe(false);
  });
});

describe("quantity total", () => {
  it("multiplies by units and rounds up", () => {
    expect(totalForQuantity(1_500, 1_000)).toBe(1_500);
    expect(totalForQuantity(1_500, 100)).toBe(150);
    expect(totalForQuantity(1_599, 3_333)).toBe(5_330); // 5329.467 -> 5330
  });

  it("is zero for a quantity that cannot be bought", () => {
    expect(totalForQuantity(1_500, 0)).toBe(0);
    expect(totalForQuantity(1_500, -1)).toBe(0);
    expect(totalForQuantity(1_500, 1.5)).toBe(0);
    expect(totalForQuantity(0, 1_000)).toBe(0);
  });
});
