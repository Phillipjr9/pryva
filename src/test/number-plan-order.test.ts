import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findPlan, plansFor } from "@/lib/services/catalog";

/**
 * The storefront shows the destination with the lowest Bitcall OTP cost first,
 * because Bitcall is the only single-use purchase route. Costs stay server-side,
 * and a catalogue read failure never takes the page offline.
 */
const fleexa = vi.hoisted(() => ({ configured: true, list: vi.fn(), buy: vi.fn() }));
const bitcall = vi.hoisted(() => ({ configured: true, list: vi.fn(), buy: vi.fn() }));

vi.mock("@/lib/providers/fleexa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/fleexa")>();
  return {
    ...actual,
    isFleexaConfigured: () => fleexa.configured,
    listFleexaSmsServices: fleexa.list,
    buyFleexaSmsNumber: fleexa.buy,
  };
});

vi.mock("@/lib/providers/bitcall", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/bitcall")>();
  return {
    ...actual,
    isBitcallConfigured: () => bitcall.configured,
    listBitcallOtpServices: bitcall.list,
    // Attribution now comes from the country catalogue; these tests exercise the
    // service-row fallback, so the country read is empty on purpose.
    listBitcallOtpCountryEntries: async () => [],
    buyBitcallOtpActivation: bitcall.buy,
  };
});

const { orderNumberPlansByCheapestCost, clearNumberPlanOrderCache } =
  await import("@/lib/services/numbers/number-plan-order");
const { clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");

/** The six sellable destinations, in catalogue order. */
const sellable = () =>
  plansFor("numbers").filter((plan) => ["vn-ng", "vn-us", "vn-uk", "vn-ca", "vn-de", "vn-gh"].includes(plan.slug));

/** Fleexa rows for a set of countries, at one naira cost each. */
function fleexaRows(costs: Record<string, number>) {
  return Object.entries(costs).map(([country, priceNgn]) => ({
    id: `svc-${country}`, country, name: "WhatsApp", priceNgn, stock: 10,
  }));
}

function gatewayRows(costs: Record<string, number>) {
  return Object.entries(costs).map(([country, usd]) => ({
    // The service catalogue states no country and accepts no country filter, so a
    // row that names its own country is the only shape the fallback can attribute.
    countryCode: `${country}_1`,
    name: "WhatsApp",
    offers: [{ serviceId: `ALPHA-${country}-whatsapp`, price: usd, currency: "USD", availableCount: 10 }],
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  clearNumberPlanOrderCache();
  clearOtpCatalogueCache();
  fleexa.configured = true;
  bitcall.configured = true;
  fleexa.list.mockResolvedValue([]);
  bitcall.list.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("number plan order", () => {
  it("puts the destination with the lowest Bitcall cost first", async () => {
    const costs = { NG: 0.01, US: 0.02, GB: 0.08, CA: 0.09, DE: 0.1, GH: 0.07 };
    bitcall.list.mockResolvedValue(gatewayRows(costs));

    const ordered = await orderNumberPlansByCheapestCost(sellable());

    expect(ordered[0].slug).toBe("vn-ng");
    expect(ordered[1].slug).toBe("vn-us");
    expect(ordered.at(-1)?.slug).toBe("vn-de");
    // The ordering crosses a public boundary: it must carry no new facts. Same
    // plan objects, same fields — no cost, no app, no supplier anywhere.
    expect(ordered.map((plan) => Object.keys(plan).sort()))
      .toEqual(sellable().map((plan) => Object.keys(plan).sort()));
    expect(JSON.stringify(ordered)).not.toContain("WhatsApp");
    expect(JSON.stringify(ordered)).not.toMatch(/fleexa|bitcall|costNgn/i);
  });

  it("keeps catalogue order when nothing is configured to compare", async () => {
    fleexa.configured = false;
    bitcall.configured = false;
    const plans = sellable();

    await expect(orderNumberPlansByCheapestCost(plans)).resolves.toEqual(plans);
    expect(fleexa.list).not.toHaveBeenCalled();
  });

  it("keeps catalogue order for destinations Bitcall cannot price", async () => {
    // Only Nigeria has a Bitcall price; all other destinations remain in place.
    bitcall.list.mockResolvedValue(gatewayRows({ NG: 0.01 }));
    const plans = sellable();

    const ordered = await orderNumberPlansByCheapestCost(plans);

    expect(ordered).toHaveLength(plans.length);
    expect(ordered[0].slug).toBe("vn-ng");
    expect(ordered.map((plan) => plan.slug).slice(1)).toEqual(["vn-us", "vn-uk", "vn-ca", "vn-de", "vn-gh"]);
  });

  it("still renders when Bitcall catalog reads fail", async () => {
    bitcall.list.mockRejectedValue(new Error("gateway down"));
    const plans = sellable();

    const ordered = await orderNumberPlansByCheapestCost(plans);

    expect(ordered).toHaveLength(plans.length);
    expect(ordered[0].slug).toBe("vn-ng");
  });

  it("reads Bitcall catalogs once and then serves from cache", async () => {
    bitcall.list.mockResolvedValue(gatewayRows({ NG: 0.01 }));

    await orderNumberPlansByCheapestCost(sellable());
    const callsAfterFirst = bitcall.list.mock.calls.length;
    await orderNumberPlansByCheapestCost(sellable());

    // A public page must not become a supplier-catalogue pager.
    expect(bitcall.list.mock.calls.length).toBe(callsAfterFirst);
  });
});
