import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BitcallEsimPlan } from "@/lib/bitcall";

/**
 * eSIM is now products, not listings.
 *
 * The catalogue used to return plans with no price and no way to buy them. These
 * tests pin the three things that make a plan sellable — a naira cost from the
 * supplier's currency, a selling price inside the margin band, and a margin that
 * clears the same floor every other live purchase clears — plus the coverage
 * rule that has to keep holding: a regional plan is never shown against a
 * country it does not name.
 */

const gateway = vi.hoisted(() => ({
  configured: vi.fn(),
  plans: vi.fn(),
  countries: vi.fn(),
  rate: 1600,
  marginOk: true,
}));

vi.mock("@/lib/bitcall", () => ({
  isBitcallConfigured: gateway.configured,
  listBitcallEsimPlans: gateway.plans,
  listBitcallEsimCountries: gateway.countries,
}));

vi.mock("@/lib/exchange-rate", () => ({
  getUsdToNgnRate: async () => ({ rate: gateway.rate, source: "override", fetchedAt: "2026-01-01T00:00:00Z" }),
}));

vi.mock("@/lib/margin-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/margin-guard")>();
  return { ...actual, checkMargin: (...args: Parameters<typeof actual.checkMargin>) => (gateway.marginOk ? actual.checkMargin(...args) : { ok: false, code: "UNPROFITABLE", costNgn: args[1], priceNgn: args[0], marginNgn: null }) };
});

function plan(overrides: Partial<BitcallEsimPlan> = {}): BitcallEsimPlan {
  return {
    planId: "pln_abc123",
    name: "Nigeria Lite",
    region: "Africa",
    countries: ["Nigeria"],
    allowance: 1,
    allowanceUnit: "GB",
    validity: 7,
    validityUnit: "days",
    price: 4.5,
    currency: "USD",
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  gateway.configured.mockReturnValue(true);
  gateway.rate = 1600;
  gateway.marginOk = true;
  gateway.countries.mockResolvedValue(["Nigeria"]);
  gateway.plans.mockResolvedValue([plan()]);
});

async function catalog(plans: BitcallEsimPlan[]) {
  gateway.plans.mockResolvedValue(plans);
  const { readEsimCatalog } = await import("@/lib/esim-catalog");
  return readEsimCatalog(true);
}

describe("eSIM offers", () => {
  it("turns the supplier's dollar price into a naira price inside the margin band", async () => {
    const { offers } = await catalog([plan({ price: 4.5 })]);
    expect(offers).toHaveLength(1);
    // $4.50 × 1,600 = ₦7,200 cost; the band is +30–50%, rounded up to ₦50.
    expect(offers[0].costNgn).toBe(7_200);
    expect(offers[0].priceNgn).toBeGreaterThanOrEqual(9_360);
    expect(offers[0].priceNgn).toBeLessThanOrEqual(10_800);
    expect(offers[0].purchasable).toBe(true);
  });

  it("reads a naira price as the cost, with no conversion", async () => {
    const { offers } = await catalog([plan({ price: 5_000, currency: "NGN" })]);
    expect(offers[0].costNgn).toBe(5_000);
    expect(offers[0].priceNgn).toBeGreaterThan(5_000);
  });

  it("leaves out a plan it cannot price, rather than guessing", async () => {
    const { offers } = await catalog([
      plan({ planId: "pln_eur", currency: "EUR", price: 4.5 }),
      plan({ planId: "pln_none", price: null }),
      plan({ planId: "pln_zero", price: 0 }),
      plan({ planId: "pln_ng" }),
    ]);
    expect(offers.map((offer) => offer.name)).toEqual(["Nigeria Lite"]);
    expect(offers[0].planId).toBe("pln_ng");
  });

  it("refuses to sell a plan the margin guard would block", async () => {
    gateway.marginOk = false;
    const { offers } = await catalog([plan()]);
    expect(offers[0].purchasable).toBe(false);

    const { esimItemsForCountry } = await import("@/lib/esim-catalog");
    const items = esimItemsForCountry(offers, "ng");
    expect(items).toHaveLength(1);
    // A real destination with no way to pay: listed, but no button.
    expect(items[0].action).toBeNull();
  });

  it("sells the priced plans and links them to their own page", async () => {
    const { offers, partial } = await catalog([plan()]);
    const { esimItemsForCountry } = await import("@/lib/esim-catalog");
    const items = esimItemsForCountry(offers, "ng");
    expect(partial).toBe(false);
    expect(items[0]).toMatchObject({
      category: "esim",
      source: "live",
      price: offers[0].priceNgn,
      action: { label: "Buy eSIM", href: `/dashboard/esim/${offers[0].id}` },
    });
  });

  it("hides the plan reference behind a stable hash", async () => {
    const first = await catalog([plan({ planId: "pln_secret_1" })]);
    const second = await catalog([plan({ planId: "pln_secret_1" })]);
    expect(first.offers[0].id).toBe(second.offers[0].id);
    expect(first.offers[0].id).toMatch(/^live-esim-[a-f0-9]{20}$/);
    expect(first.offers[0].id).not.toContain("pln_secret");

    const { esimItemsForCountry } = await import("@/lib/esim-catalog");
    const item = esimItemsForCountry(first.offers, "ng")[0] as unknown as Record<string, unknown>;
    expect(JSON.stringify(item)).not.toContain("pln_secret");
  });

  it("never lets the supplier's name reach a listing", async () => {
    const { offers } = await catalog([plan({ name: "Bitcall Global", region: "Bitcall Africa" })]);
    expect(offers[0].name).toBe("eSIM data plan");
    expect(offers[0].region).not.toMatch(/bitcall/i);
  });

  it("drops a plan with no usable reference", async () => {
    const { offers } = await catalog([plan({ planId: null }), plan({ planId: "not-a-pln-ref" })]);
    expect(offers).toEqual([]);
  });

  it("sorts the catalogue by price, cheapest first", async () => {
    const { offers } = await catalog([
      plan({ planId: "pln_big", name: "Global", price: 30 }),
      plan({ planId: "pln_small", name: "Lite", price: 3 }),
      plan({ planId: "pln_mid", name: "Plus", price: 12 }),
    ]);
    expect(offers.map((offer) => offer.name)).toEqual(["Lite", "Plus", "Global"]);
  });
});

describe("eSIM coverage", () => {
  it("shows a plan only where the catalog states coverage explicitly", async () => {
    const { offers } = await catalog([
      plan({ planId: "pln_ng", countries: ["Nigeria", "Ghana"] }),
      plan({ planId: "pln_gh", name: "Ghana Plus", countries: ["Ghana"] }),
      plan({ planId: "pln_de", name: "Germany", region: "Europe", countries: ["Germany", "France"] }),
    ]);
    const { esimItemsForCountry } = await import("@/lib/esim-catalog");

    // A Europe-only plan is not shown for Nigeria: guessing coverage would
    // advertise service that may not exist there.
    expect(esimItemsForCountry(offers, "ng").map((item) => item.name)).toEqual(["Nigeria Lite"]);
    expect(esimItemsForCountry(offers, "gh")).toHaveLength(2);
    expect(esimItemsForCountry(offers, "de").map((item) => item.name)).toEqual(["Germany"]);
    expect(esimItemsForCountry(offers, "not-a-country")).toEqual([]);
  });

  it("matches the country code, its name, and the usual alternatives", async () => {
    const plans = [
      plan({ planId: "pln_code", countries: ["NG"] }),
      plan({ planId: "pln_name", countries: ["Nigeria"] }),
      plan({ planId: "pln_uk", countries: ["UK"] }),
      plan({ planId: "pln_usa", countries: ["USA"] }),
    ];
    const { offers } = await catalog(plans);
    const { esimItemsForCountry } = await import("@/lib/esim-catalog");
    expect(esimItemsForCountry(offers, "ng")).toHaveLength(2);
    expect(esimItemsForCountry(offers, "gb")).toHaveLength(1);
    expect(esimItemsForCountry(offers, "us")).toHaveLength(1);
  });

  it("shows a global plan for every country, labelled as global", async () => {
    const { offers } = await catalog([plan({ planId: "pln_global", name: "Global", region: "Worldwide", countries: [] })]);
    const { esimItemsForCountry } = await import("@/lib/esim-catalog");
    for (const code of ["ng", "de", "jp"]) {
      const items = esimItemsForCountry(offers, code);
      expect(items).toHaveLength(1);
      expect(items[0].coverage).toBe("not-country-specific");
    }
  });
});

describe("eSIM catalogue reads", () => {
  it("fails closed when the provider is not configured", async () => {
    const { readEsimCatalog } = await import("@/lib/esim-catalog");
    gateway.configured.mockReturnValue(false);
    await expect(readEsimCatalog(true)).rejects.toThrow(/not configured/i);
    gateway.configured.mockReturnValue(true);
  });

  it("fails when the plan list cannot be read, but degrades when only the country list fails", async () => {
    const { readEsimCatalog } = await import("@/lib/esim-catalog");
    gateway.plans.mockRejectedValue(new Error("down"));
    await expect(readEsimCatalog(true)).rejects.toThrow(/unavailable/i);
    expect(gateway.configured).toHaveBeenCalled();
  });

  it("marks a partial read instead of pretending the catalogue is complete", async () => {
    gateway.countries.mockRejectedValue(new Error("down"));
    const { partial, offers } = await catalog([plan()]);
    expect(offers).toHaveLength(1);
    expect(partial).toBe(true);
  });
});
