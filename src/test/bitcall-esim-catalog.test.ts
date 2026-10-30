import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BitcallEsimPlan } from "@/lib/bitcall";
import type { EsimSnapshot } from "@/lib/bitcall-esim-catalog";

const gateway = vi.hoisted(() => ({ configured: vi.fn(), plans: vi.fn(), countries: vi.fn() }));
vi.mock("@/lib/bitcall", () => ({
  isBitcallConfigured: gateway.configured,
  listBitcallEsimPlans: gateway.plans,
  listBitcallEsimCountries: gateway.countries,
}));

function plan(overrides: Partial<BitcallEsimPlan> = {}): BitcallEsimPlan {
  return {
    planId: "pln_abc123", name: "Nigeria Lite", region: "Africa", countries: ["Nigeria"],
    allowance: 1, allowanceUnit: "GB", validity: 7, validityUnit: "days",
    price: 4.5, currency: "USD",
    ...overrides,
  };
}

function snapshot(plans: BitcallEsimPlan[]): EsimSnapshot {
  return { plans, countries: ["Nigeria"], partial: false, fetchedAt: "2026-01-01T00:00:00Z" };
}

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  gateway.configured.mockReturnValue(true);
});

describe("eSIM catalog listings", () => {
  it("shows a plan only where the catalog states coverage explicitly", async () => {
    const { esimItemsForCountry } = await import("@/lib/bitcall-esim-catalog");
    const plans = [
      plan({ planId: "pln_ng", countries: ["Nigeria", "Ghana"] }),
      plan({ planId: "pln_gh", name: "Ghana Plus", countries: ["Ghana"] }),
      plan({ planId: "pln_de", name: "Germany", region: "Europe", countries: ["Germany", "France"] }),
    ];

    const nigeria = esimItemsForCountry(snapshot(plans), "ng");
    // Ghana-only and Europe-only plans are not shown for Nigeria: guessing
    // coverage would advertise service that may not exist there.
    expect(nigeria.map((item) => item.id)).toHaveLength(1);
    expect(nigeria[0]).toMatchObject({ name: "Nigeria Lite", coverage: "catalog-country" });

    const ghana = esimItemsForCountry(snapshot(plans), "gh");
    expect(ghana).toHaveLength(2);

    const germany = esimItemsForCountry(snapshot(plans), "de");
    expect(germany).toHaveLength(1);
    expect(germany[0].name).toBe("Germany");

    expect(esimItemsForCountry(snapshot(plans), "not-a-country")).toEqual([]);
  });

  it("matches the country code, its name, and the usual alternatives", async () => {
    const { esimItemsForCountry } = await import("@/lib/bitcall-esim-catalog");
    expect(esimItemsForCountry(snapshot([plan({ countries: ["NG"] })]), "ng")).toHaveLength(1);
    expect(esimItemsForCountry(snapshot([plan({ countries: ["Nigeria"] })]), "ng")).toHaveLength(1);
    expect(esimItemsForCountry(snapshot([plan({ countries: ["UK"] })]), "gb")).toHaveLength(1);
    expect(esimItemsForCountry(snapshot([plan({ countries: ["USA"] })]), "us")).toHaveLength(1);
    expect(esimItemsForCountry(snapshot([plan({ countries: ["United States of America"] })]), "us")).toHaveLength(1);
    // A dialling code is never inferred from a country name.
    expect(esimItemsForCountry(snapshot([plan({ countries: ["234"] })]), "ng")).toHaveLength(0);
  });

  it("shows a plan whose region is stated as global, for every country", async () => {
    const { esimItemsForCountry } = await import("@/lib/bitcall-esim-catalog");
    const global = plan({ planId: "pln_global", name: "Global 5GB", region: "Global", countries: [] });
    for (const code of ["ng", "us", "de", "jp"]) {
      const [item] = esimItemsForCountry(snapshot([global]), code);
      expect(item, code).toMatchObject({ name: "Global 5GB", coverage: "not-country-specific" });
    }
    // A multi-country region that is not global is still not shown per country.
    expect(esimItemsForCountry(snapshot([plan({ region: "Europe", countries: [] })]), "ng")).toHaveLength(0);
  });

  it("is read-only: no price, no stock, no checkout", async () => {
    const { esimItemsForCountry } = await import("@/lib/bitcall-esim-catalog");
    const [item] = esimItemsForCountry(snapshot([plan()]), "ng");
    expect(item).toMatchObject({
      category: "esim", source: "live", artwork: { kind: "service", name: "esim" },
      // Pricing is undecided because their catalog does not say whether the
      // returned figure is our cost or a suggested retail price. Stock is null
      // because availability is answered at purchase time, and unknown must not
      // render as zero. Action is null because ordering is not wired.
      price: null, stock: null, myUnits: null, action: null,
    });
  });

  it("hides the plan reference and the returned price", async () => {
    const { esimItemsForCountry } = await import("@/lib/bitcall-esim-catalog");
    const [item] = esimItemsForCountry(snapshot([plan({ planId: "pln_secret999", price: 4.5 })]), "ng");
    expect(item.id).toMatch(/^live-esim-[0-9a-f]{20}$/);
    const serialized = JSON.stringify(item);
    expect(serialized).not.toContain("pln_secret999");
    expect(serialized).not.toContain("4.5");
  });

  it("never lets the provider name reach a listing", async () => {
    const { esimItemsForCountry } = await import("@/lib/bitcall-esim-catalog");
    const items = esimItemsForCountry(snapshot([
      plan({ planId: "pln_1", name: "Bitcall Nigeria Lite" }),
      plan({ planId: "pln_2", name: null, region: "BITCALL Africa" }),
    ]), "ng");
    expect(items).toHaveLength(2);
    expect(JSON.stringify(items).toLowerCase()).not.toContain("bitcall");
    // An unusable name falls back to a plain label rather than dropping the plan.
    expect(items.map((item) => item.name)).toEqual(["eSIM data plan", "eSIM data plan"]);
  });

  it("drops a plan with no usable reference", async () => {
    const { esimItemsForCountry } = await import("@/lib/bitcall-esim-catalog");
    expect(esimItemsForCountry(snapshot([plan({ planId: null })]), "ng")).toEqual([]);
  });
});

describe("eSIM snapshot", () => {
  it("fails closed when the provider is not configured", async () => {
    gateway.configured.mockReturnValue(false);
    const { readEsimSnapshot } = await import("@/lib/bitcall-esim-catalog");
    await expect(readEsimSnapshot()).rejects.toThrow("eSIM provider not configured");
    expect(gateway.plans).not.toHaveBeenCalled();
  });

  it("fails when the catalog cannot be read, but degrades when only the country list fails", async () => {
    gateway.plans.mockRejectedValue(new Error("gateway down"));
    const { readEsimSnapshot } = await import("@/lib/bitcall-esim-catalog");
    await expect(readEsimSnapshot()).rejects.toThrow("eSIM catalog unavailable");

    vi.resetModules();
    gateway.configured.mockReturnValue(true);
    gateway.plans.mockResolvedValue([plan()]);
    gateway.countries.mockRejectedValue(new Error("country list unavailable"));
    const reloaded = await import("@/lib/bitcall-esim-catalog");
    expect(await reloaded.readEsimSnapshot()).toMatchObject({ partial: true, countries: [] });
  });

  it("caps the catalog, caches briefly and deduplicates concurrent reads", async () => {
    gateway.plans.mockResolvedValue(Array.from({ length: 2500 }, (_, index) => plan({ planId: `pln_${index}` })));
    gateway.countries.mockResolvedValue(["Nigeria"]);
    const { readEsimSnapshot } = await import("@/lib/bitcall-esim-catalog");

    const [first, second] = await Promise.all([readEsimSnapshot(), readEsimSnapshot()]);
    expect(first).toBe(second);
    expect(gateway.plans).toHaveBeenCalledTimes(1);
    expect(first.plans).toHaveLength(2000);

    await readEsimSnapshot();
    expect(gateway.plans).toHaveBeenCalledTimes(1);
    await readEsimSnapshot(true);
    expect(gateway.plans).toHaveBeenCalledTimes(2);
  });
});
