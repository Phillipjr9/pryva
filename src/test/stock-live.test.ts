import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Building the live stock report.
 *
 * The rules worth pinning are about isolation and honesty: one feed being down
 * must not hide the other four, "not configured" must never read as "empty", and
 * a lane that answers with nothing must say so rather than look healthy.
 */

const state = vi.hoisted(() => ({
  fleexa: true,
  bulkacc: true,
  smm: true,
  bitcall: true,
  snapshot: null as unknown,
  snapshotError: null as string | null,
  boost: null as unknown,
  boostError: null as string | null,
  products: null as unknown,
  productsError: null as string | null,
  manual: 0,
  accszone: false,
  otpCountries: [] as unknown[],
}));

vi.mock("@/lib/providers/fleexa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/fleexa")>();
  return { ...actual, isFleexaConfigured: () => state.fleexa };
});

vi.mock("@/lib/services/numbers/fleexa-catalog", () => ({
  readSupplierSnapshot: async () => {
    if (state.snapshotError) throw new Error(state.snapshotError);
    return state.snapshot;
  },
}));

vi.mock("@/lib/providers/bulkacc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/bulkacc")>();
  return {
    ...actual,
    isBulkaccConfigured: () => state.bulkacc,
    listProducts: async () => {
      if (state.productsError) throw new Error(state.productsError);
      return state.products;
    },
  };
});

vi.mock("@/lib/providers/smm-panel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/smm-panel")>();
  return { ...actual, isSmmPanelConfigured: () => state.smm };
});

vi.mock("@/lib/services/boosts/smm-catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/boosts/smm-catalog")>();
  return {
    ...actual,
    readBoostSnapshot: async () => {
      if (state.boostError) throw new Error(state.boostError);
      return state.boost;
    },
  };
});

vi.mock("@/lib/providers/bitcall", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/bitcall")>();
  return { ...actual, isBitcallConfigured: () => state.bitcall, listBitcallOtpCountryEntries: async () => state.otpCountries };
});

vi.mock("@/lib/providers/accszone", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/accszone")>();
  return { ...actual, isAccsZoneConfigured: () => state.accszone };
});

vi.mock("@/lib/services/accounts/manual-catalog", () => ({ availableManualProducts: () => Array(state.manual).fill({}) }));

vi.mock("@/lib/services/accounts/marketplace-suppliers", () => ({
  isMarketplaceCatalogAvailable: () => state.bulkacc || state.accszone,
  listMarketplaceListings: async () => {
    if (state.productsError) throw new Error(state.productsError);
    const page = state.products as { items: import("@/lib/providers/bulkacc").BulkaccProduct[]; totalCount: number };
    return { listings: page.items.map((product) => ({ slug: `p1:${product.code}`, title: product.name,
      group: product.groupName, category: product.categoryName, stock: product.inStock,
      minQuantity: product.min, priceUsd: String(product.priceMicros / 1_000_000),
    })), meta: { total: page.totalCount }, partial: false };
  },
}));

import { buildStockReport } from "@/lib/admin/stock-live";
import { laneHeadline } from "@/lib/admin/stock-report";

function snapshot() {
  return {
    email: [{ id: "e1", name: "Gmail inbox", domain: "gmail.com", priceNgn: 500, stock: 3 }],
    rentals: [{ id: "r1", country: "ng", pricePerMonthNgn: 20_000, stock: 2 }],
    partial: false,
    fetchedAt: new Date().toISOString(),
  };
}

function boostSnapshot() {
  return {
    services: [
      {
        id: "100",
        name: "Instagram Followers",
        category: "Instagram",
        type: "default",
        ratePer1000: 5,
        currency: "NGN",
        min: 100,
        max: 10_000,
        refill: true,
        cancel: true,
        dripfeed: false,
      },
    ],
    currency: "NGN",
    balance: 50_000,
    partial: false,
    fetchedAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  state.fleexa = true;
  state.bulkacc = true;
  state.smm = true;
  state.bitcall = true;
  state.otpCountries = [{
    countryCode: "NG_1", name: "Nigeria", serviceCount: 1, availableCount: 15, startingPrice: 900, currency: "NGN",
    pools: [{ serviceId: "s1", price: 900, currency: "NGN", availableCount: 15, successRate: 90 }],
  }];
  state.snapshot = snapshot();
  state.snapshotError = null;
  state.boost = boostSnapshot();
  state.boostError = null;
  state.products = {
    items: [
      {
        code: "P1",
        name: "Netflix 1 month",
        description: null,
        groupName: "Netflix",
        categoryName: "Premium",
        inStock: 12,
        min: 1,
        priceMicros: 1_500_000,
      },
    ],
    totalCount: 1,
    pageIndex: 1,
    pageSize: 40,
    totalPages: 1,
  };
  state.productsError = null;
  state.manual = 0;
  state.accszone = false;
});

describe("the stock report", () => {
  it("covers every lane the shop sells, plus the one it does not", async () => {
    const report = await buildStockReport();
    expect(report.lanes.map((lane) => lane.lane)).toEqual([
      "numbers",
      "rentals",
      "email-otp",
      "accounts",
      "boosts",
      "esim",
    ]);
  });

  it("reads inventory into the lane that sells it", async () => {
    const { lanes } = await buildStockReport();
    const numbers = lanes.find((lane) => lane.lane === "numbers")!;
    expect(numbers.lines.find((line) => line.id === "vn-ng")?.stock).toBe(15);
    expect(numbers.sellable).toBeGreaterThan(0);
  });

  it("keeps the rest of the report when one feed throws", async () => {
    state.boostError = "panel unreachable";
    const { lanes } = await buildStockReport();
    const boosts = lanes.find((lane) => lane.lane === "boosts")!;
    expect(boosts.connected).toBe(false);
    expect(laneHeadline(boosts)).toBe("panel unreachable");
    expect(lanes.find((lane) => lane.lane === "accounts")!.error).toBeNull();
  });

  it("uses a truthful 'not configured' state rather than a misleading feed status when a key is missing", async () => {
    state.fleexa = false;
    state.bitcall = false;
    state.bulkacc = false;
    state.smm = false;
    const { lanes } = await buildStockReport();
    for (const id of ["numbers", "rentals", "accounts", "boosts"]) {
      const lane = lanes.find((entry) => entry.lane === id)!;
      expect(lane.connected, id).toBe(false);
      expect(lane.error).toBe("not configured in this environment");
    }
  });

  it("stops reporting email inboxes as stock once the feed stops answering", async () => {
    state.snapshot = { ...snapshot(), email: [] };
    const { lanes } = await buildStockReport();
    const email = lanes.find((lane) => lane.lane === "email-otp")!;
    expect(email.lines).toEqual([]);
    expect(laneHeadline(email)).toBe("the feed returned nothing");
  });

  it("does not count retired manual inventory alongside the API feed", async () => {
    state.manual = 2;
    const { lanes } = await buildStockReport();
    expect(lanes.find((lane) => lane.lane === "accounts")!.error).toBeNull();
  });

  it("uses an API-only catalogue even with only the secondary source connected", async () => {
    state.accszone = true;
    state.bulkacc = false;
    state.manual = 10;
    const { lanes } = await buildStockReport();
    const accounts = lanes.find((lane) => lane.lane === "accounts")!;
    expect(accounts.connected).toBe(true);
    expect(accounts.error).toBeNull();
    expect(accounts.lines.some((line) => line.id === "alternate-marketplace")).toBe(false);
  });

  it("marks eSIM as connected but not sold, so it never counts as buyable", async () => {
    const { lanes } = await buildStockReport();
    const esim = lanes.find((lane) => lane.lane === "esim")!;
    expect(esim.connected).toBe(true);
    expect(esim.sellable).toBe(0);
    expect(esim.lines[0].state).toBe("not-sold");
  });
});
