import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BitcallEsimPlan } from "@/lib/providers/bitcall";

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
  preview: false,
  plans: vi.fn(),
  countries: vi.fn(),
  usdRate: 1600 as number | null,
  eurRate: 1800 as number | null,
  single: vi.fn(),
  marginOk: true,
}));

vi.mock("@/lib/platform/demo-policy", () => ({ isPreviewDatabase: () => gateway.preview }));
vi.mock("@/lib/providers/bitcall", () => ({
  isBitcallConfigured: gateway.configured,
  listBitcallEsimPlans: gateway.plans,
  listBitcallEsimCountries: gateway.countries,
  getBitcallEsimPlan: gateway.single,
}));

vi.mock("@/lib/payments/exchange-rate", () => ({
  getFreshNgnRate: async (currency: "USD" | "EUR") => {
    const rate = currency === "USD" ? gateway.usdRate : gateway.eurRate;
    return rate === null ? null : { rate, source: "override", fetchedAt: "2026-01-01T00:00:00Z" };
  },
}));

vi.mock("@/lib/services/margin-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/margin-guard")>();
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
    unlimitedData: false,
    validity: 7,
    validityUnit: "days",
    price: 4.5,
    currency: "USD",
    includesPhoneNumber: null,
    supportsVoice: null,
    supportsSms: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  gateway.configured.mockReturnValue(true);
  gateway.preview = false;
  gateway.usdRate = 1600;
  gateway.eurRate = 1800;
  gateway.marginOk = true;
  gateway.countries.mockResolvedValue(["Nigeria"]);
  gateway.plans.mockResolvedValue({ plans: [plan()], returned: 1, unreadable: 0, partial: false });
  gateway.single.mockResolvedValue(plan());
});

async function catalog(plans: BitcallEsimPlan[]) {
  gateway.plans.mockResolvedValue({ plans, returned: plans.length, unreadable: 0, partial: false });
  const { readEsimCatalog } = await import("@/lib/services/esim/esim-catalog");
  return readEsimCatalog(true);
}

afterEach(() => vi.unstubAllEnvs());

describe("eSIM offers", () => {
  it("does not load the live catalogue from a Vercel preview with a persistent database", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://mock.invalid/db");
    vi.stubEnv("VERCEL_ENV", "preview");
    const { readEsimCatalog } = await import("@/lib/services/esim/esim-catalog");
    await expect(readEsimCatalog()).rejects.toThrow(/unavailable in this environment/i);
    expect(gateway.plans).not.toHaveBeenCalled();
    expect(gateway.countries).not.toHaveBeenCalled();
  });

  it("never loads the live catalogue in an in-memory preview", async () => {
    gateway.preview = true;
    const { readEsimCatalog } = await import("@/lib/services/esim/esim-catalog");
    await expect(readEsimCatalog()).rejects.toThrow(/unavailable in this environment/i);
    expect(gateway.plans).not.toHaveBeenCalled();
  });

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

  it("prices an explicitly denominated euro plan using a real configured or current rate", async () => {
    const { offers } = await catalog([plan({ planId: "pln_eur", currency: "EUR", price: 4.5 })]);
    expect(offers[0].costNgn).toBe(8_100);
    expect(offers[0].priceNgn).toBeGreaterThan(8_100);
    expect(offers[0].purchasable).toBe(true);
  });

  it("keeps unpriceable plans visible but never sells them or invents an exchange rate", async () => {
    gateway.eurRate = null;
    const { offers, listings, stats } = await catalog([
      plan({ planId: "pln_eur", name: "Euro plan", currency: "EUR", price: 4.5 }),
      plan({ planId: "pln_none", name: "No amount", price: null }),
      plan({ planId: "pln_zero", name: "Zero amount", price: 0 }),
      plan({ planId: "pln_unknown", name: "No currency", currency: null }),
      plan({ planId: "pln_other", name: "Other currency", currency: "GBP" }),
      plan({ planId: "pln_ng", name: "Priced" }),
    ]);
    expect(offers.map((offer) => offer.planId)).toEqual(["pln_ng"]);
    expect(listings).toHaveLength(6);
    expect(listings.filter((item) => item.priceNgn === null)).toHaveLength(5);
    expect(listings.filter((item) => item.priceNgn === null).every((item) => !item.purchasable)).toBe(true);
    expect(stats).toMatchObject({ skippedRate: 1, skippedNoPrice: 2, skippedCurrency: 2 });
    const { esimItemsForCountry, catalogueItems, findEsimOffer } = await import("@/lib/services/esim/esim-catalog");
    const euro = listings.find((listing) => listing.planId === "pln_eur")!;
    expect(catalogueItems([euro])[0]).toMatchObject({ priceNgn: null, purchasable: false });
    expect(esimItemsForCountry([euro], "ng")[0]).toMatchObject({ price: null, action: null });
    expect(await findEsimOffer(euro.id)).toBeNull();
    expect(JSON.stringify(catalogueItems([euro]))).not.toContain("pln_eur");
  });

  it("rounds fractional cost up, never understating the input to the margin guard", async () => {
    const { offers } = await catalog([plan({ price: 0.01001, currency: "EUR" })]);
    expect(offers[0].costNgn).toBe(19); // 18.018 NGN, rounded up
  });

  it("uses the documented unlimited flag rather than inventing a data allowance", async () => {
    const { listings } = await catalog([plan({ unlimitedData: true, allowance: null, allowanceUnit: null })]);
    expect(listings[0].dataLabel).toBe("Unlimited data");
  });

  it("passes provider-reported phone and service flags through without changing unknowns", async () => {
    const { offers } = await catalog([
      plan({ planId: "pln_yes", includesPhoneNumber: true, supportsVoice: false, supportsSms: true }),
      plan({ planId: "pln_no", includesPhoneNumber: false, supportsVoice: true, supportsSms: false }),
      plan({ planId: "pln_unknown" }),
    ]);
    const byPlan = new Map(offers.map((offer) => [offer.planId, offer]));
    expect(byPlan.get("pln_yes")).toMatchObject({ includesPhoneNumber: true, supportsVoice: false, supportsSms: true });
    expect(byPlan.get("pln_no")).toMatchObject({ includesPhoneNumber: false, supportsVoice: true, supportsSms: false });
    expect(byPlan.get("pln_unknown")).toMatchObject({ includesPhoneNumber: null, supportsVoice: null, supportsSms: null });
  });

  it("refuses to sell a plan the margin guard would block", async () => {
    gateway.marginOk = false;
    const { offers } = await catalog([plan()]);
    expect(offers[0].purchasable).toBe(false);

    const { esimItemsForCountry } = await import("@/lib/services/esim/esim-catalog");
    const items = esimItemsForCountry(offers, "ng");
    expect(items).toHaveLength(1);
    // A real destination with no way to pay: listed, but no button.
    expect(items[0].action).toBeNull();
  });

  it("sells the priced plans and links them to their own page", async () => {
    const { offers, partial } = await catalog([plan()]);
    const { esimItemsForCountry } = await import("@/lib/services/esim/esim-catalog");
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

    const { esimItemsForCountry } = await import("@/lib/services/esim/esim-catalog");
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
    const { esimItemsForCountry } = await import("@/lib/services/esim/esim-catalog");

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
    const { esimItemsForCountry } = await import("@/lib/services/esim/esim-catalog");
    expect(esimItemsForCountry(offers, "ng")).toHaveLength(2);
    expect(esimItemsForCountry(offers, "gb")).toHaveLength(1);
    expect(esimItemsForCountry(offers, "us")).toHaveLength(1);
  });

  it("shows a global-labelled plan without named countries with unconfirmed coverage", async () => {
    const { offers } = await catalog([plan({ planId: "pln_global", name: "Global", region: "Worldwide", countries: [] })]);
    const { esimItemsForCountry } = await import("@/lib/services/esim/esim-catalog");
    for (const code of ["ng", "de", "jp"]) {
      const items = esimItemsForCountry(offers, code);
      expect(items).toHaveLength(1);
      expect(items[0].coverage).toBe("unconfirmed");
    }
  });
  it("does not show a global-labelled plan for countries outside its explicit coverage list", async () => {
    const { listings } = await catalog([plan({ planId: "pln_global_limited", name: "Global", region: "Worldwide", countries: ["NG", "GH"] })]);
    const { esimItemsForCountry } = await import("@/lib/services/esim/esim-catalog");
    expect(esimItemsForCountry(listings, "ng")).toHaveLength(1);
    expect(esimItemsForCountry(listings, "de")).toHaveLength(0);
  });
});

describe("checkout plan terms", () => {
  it("changes when visible details or features change, but not when coverage is reordered", async () => {
    const { offers } = await catalog([plan({ countries: ["NG", "GH"] })]);
    const { esimOfferTerms } = await import("@/lib/services/esim/esim-catalog");
    const base = offers[0];
    const fingerprint = esimOfferTerms(base);
    expect(fingerprint).toMatch(/^[a-f0-9]{24}$/);
    expect(esimOfferTerms({ ...base, countries: ["GH", "NG"] })).toBe(fingerprint);
    for (const changed of [
      { ...base, dataLabel: "2GB of data" },
      { ...base, countries: ["NG"] },
      { ...base, includesPhoneNumber: true },
      { ...base, validityLabel: "30 days" },
    ]) expect(esimOfferTerms(changed)).not.toBe(fingerprint);
  });
});

describe("eSIM catalogue counters", () => {
  it("says why the catalogue came out the size it did", async () => {
    const { offers } = await catalog([
      plan({ planId: "pln_a", countries: ["Nigeria"], price: 4, currency: "USD" }),
      plan({ planId: "pln_b", name: "Other currency", countries: ["Germany"], price: 6, currency: "GBP" }),
      plan({ planId: "pln_c", name: "No price", countries: ["Ghana"], price: null }),
      plan({ planId: "pln_d", name: "Global", region: "Worldwide", countries: [] , price: 9 }),
    ]);
    const { stats } = await (await import("@/lib/services/esim/esim-catalog")).readEsimCatalog();
    expect(stats.returned).toBe(4);
    expect(stats.priced).toBe(offers.length);
    expect(stats.skippedCurrency).toBe(1);
    expect(stats.skippedNoPrice).toBe(1);
    // Unpriced plans still carry their reported coverage, without buy buttons.
    expect(stats.withCoverage).toBe(3);
    expect(stats.global).toBe(1);
    expect(stats.purchasable).toBeLessThanOrEqual(offers.length);
  });
});

describe("eSIM catalogue reads", () => {
  it("reports a partial plan feed rather than claiming the first pages are complete", async () => {
    gateway.plans.mockResolvedValue({ plans: [plan()], returned: 1, unreadable: 0, partial: true });
    const { readEsimCatalog } = await import("@/lib/services/esim/esim-catalog");
    expect((await readEsimCatalog(true)).partial).toBe(true);
  });

  it("rechecks the selected plan and prices it again before checkout", async () => {
    const { offers } = await catalog([plan()]);
    gateway.single.mockResolvedValue(plan({ price: 6 }));
    const { recheckEsimOffer } = await import("@/lib/services/esim/esim-catalog");
    const fresh = await recheckEsimOffer(offers[0]);
    expect(gateway.single).toHaveBeenCalledWith("pln_abc123", {});
    expect(fresh!.costNgn).toBe(9_600);
    expect(fresh!.priceNgn).toBeGreaterThan(offers[0].priceNgn);
    gateway.single.mockResolvedValue(plan({ planId: "pln_different" }));
    expect(await recheckEsimOffer(offers[0])).toBeNull();
    gateway.single.mockResolvedValue(plan({ currency: null }));
    expect(await recheckEsimOffer(offers[0])).toBeNull();
  });

  it("fails closed when the provider is not configured", async () => {
    const { readEsimCatalog } = await import("@/lib/services/esim/esim-catalog");
    gateway.configured.mockReturnValue(false);
    await expect(readEsimCatalog(true)).rejects.toThrow(/not configured/i);
    gateway.configured.mockReturnValue(true);
  });

  it("fails when the plan list cannot be read, but degrades when only the country list fails", async () => {
    const { readEsimCatalog } = await import("@/lib/services/esim/esim-catalog");
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

  it("keeps the last whole catalogue when our own cap cuts a walk short", async () => {
    // The cap is ours. A read it cut short is shorter because we stopped asking,
    // not because the supplier stopped publishing — so publishing the shorter
    // list would shrink the shop to fit our own limit.
    const { readEsimCatalog } = await import("@/lib/services/esim/esim-catalog");
    gateway.plans.mockResolvedValue({
      plans: [plan({ planId: "pln_a" }), plan({ planId: "pln_b" })],
      returned: 2,
      unreadable: 0,
      partial: false,
      partialReason: null,
    });
    const whole = await readEsimCatalog(true);
    expect(whole.offers).toHaveLength(2);

    gateway.plans.mockResolvedValue({
      plans: [plan({ planId: "pln_a" })],
      returned: 200,
      unreadable: 0,
      partial: true,
      partialReason: "budget",
    });
    const cut = await readEsimCatalog(true);

    expect(cut.offers).toHaveLength(2);
    expect(cut.offers.map((offer) => offer.id)).toEqual(whole.offers.map((offer) => offer.id));
  });

  it("stops standing in for a cut-short walk once the last whole read is old", async () => {
    const { readEsimCatalog } = await import("@/lib/services/esim/esim-catalog");
    gateway.plans.mockResolvedValue({
      plans: [plan({ planId: "pln_a" }), plan({ planId: "pln_b" })],
      returned: 2,
      unreadable: 0,
      partial: false,
      partialReason: null,
    });
    await readEsimCatalog(true);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 31 * 60_000);
      gateway.plans.mockResolvedValue({
        plans: [plan({ planId: "pln_a" })],
        returned: 200,
        unreadable: 0,
        partial: true,
        partialReason: "budget",
      });
      const cut = await readEsimCatalog(true);

      // Thirty minutes of a cap is enough: after that the shorter list stands,
      // marked partial, rather than a half-hour-old catalogue pretending to be live.
      expect(cut.offers).toHaveLength(1);
      expect(cut.partial).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
