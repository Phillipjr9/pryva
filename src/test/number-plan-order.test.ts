import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findPlan, plansFor } from "@/lib/catalog";

/**
 * The storefront shows the destination it can serve most cheaply first.
 *
 * The selling price is fixed per plan, so the cheapest supplier is the widest
 * margin — but this ordering is rendered on a public page, so it must never
 * carry a cost, and a supplier that stops answering must never stop the page.
 */
const fleexa = vi.hoisted(() => ({ configured: true, list: vi.fn(), buy: vi.fn() }));
const bitcall = vi.hoisted(() => ({ configured: true, list: vi.fn(), buy: vi.fn() }));

vi.mock("@/lib/fleexa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fleexa")>();
  return {
    ...actual,
    isFleexaConfigured: () => fleexa.configured,
    listFleexaSmsServices: fleexa.list,
    buyFleexaSmsNumber: fleexa.buy,
  };
});

vi.mock("@/lib/bitcall", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bitcall")>();
  return {
    ...actual,
    isBitcallConfigured: () => bitcall.configured,
    listBitcallOtpServices: bitcall.list,
    buyBitcallOtpActivation: bitcall.buy,
  };
});

const { orderNumberPlansByCheapestCost, clearNumberPlanOrderCache } =
  await import("@/lib/number-plan-order");
const { clearOtpCatalogueCache } = await import("@/lib/otp-suppliers");

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
    name: "WhatsApp",
    offers: [{ serviceId: `pool-${country}`, price: usd, currency: "USD", availableCount: 10 }],
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
  it("puts the destination that costs least to serve first", async () => {
    // Ghana is expensive on the first supplier, Nigeria cheap on the second.
    fleexa.list.mockResolvedValue(fleexaRows({ ng: 900, us: 1_100, gb: 1_300, ca: 1_500, de: 1_600, gh: 100 }));
    bitcall.list.mockImplementation(async ({ countryCode }: { countryCode: string }) =>
      countryCode === "NG" ? gatewayRows({ ng: 0.01 }) : [], // 15 naira
    );

    const ordered = await orderNumberPlansByCheapestCost(sellable());

    expect(ordered[0].slug).toBe("vn-ng"); // 15 naira, the cheapest of all
    expect(ordered[1].slug).toBe("vn-gh"); // 100
    expect(ordered.at(-1)?.slug).toBe("vn-de"); // 1,600
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

  it("keeps catalogue order for destinations it cannot price", async () => {
    // Nobody prices Canada, so it stays where it was rather than being dropped.
    fleexa.list.mockResolvedValue(fleexaRows({ ng: 900 }));
    bitcall.list.mockResolvedValue([]);
    const plans = sellable();

    const ordered = await orderNumberPlansByCheapestCost(plans);

    expect(ordered).toHaveLength(plans.length);
    expect(ordered[0].slug).toBe("vn-ng");
    expect(ordered.map((plan) => plan.slug).slice(1)).toEqual(["vn-us", "vn-uk", "vn-ca", "vn-de", "vn-gh"]);
  });

  it("still renders when a supplier fails", async () => {
    fleexa.list.mockRejectedValue(new Error("supplier down"));
    bitcall.list.mockResolvedValue(gatewayRows({ ng: 0.01 }));
    const plans = sellable();

    const ordered = await orderNumberPlansByCheapestCost(plans);

    expect(ordered).toHaveLength(plans.length);
    expect(ordered[0].slug).toBe("vn-ng");
  });

  it("reads the catalogues once and then serves from cache", async () => {
    fleexa.list.mockResolvedValue(fleexaRows({ ng: 900, us: 1_100, gb: 1_300, ca: 1_500, de: 1_600, gh: 900 }));

    await orderNumberPlansByCheapestCost(sellable());
    const callsAfterFirst = fleexa.list.mock.calls.length;
    await orderNumberPlansByCheapestCost(sellable());

    // A public page must not become a supplier-catalogue pager.
    expect(fleexa.list.mock.calls.length).toBe(callsAfterFirst);
  });
});
