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
}));

vi.mock("@/lib/fleexa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fleexa")>();
  return { ...actual, isFleexaConfigured: () => state.fleexa };
});

vi.mock("@/lib/fleexa-catalog", () => ({
  readSupplierSnapshot: async () => {
    if (state.snapshotError) throw new Error(state.snapshotError);
    return state.snapshot;
  },
}));

vi.mock("@/lib/bulkacc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bulkacc")>();
  return {
    ...actual,
    isBulkaccConfigured: () => state.bulkacc,
    listProducts: async () => {
      if (state.productsError) throw new Error(state.productsError);
      return state.products;
    },
  };
});

vi.mock("@/lib/smm-panel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/smm-panel")>();
  return { ...actual, isSmmPanelConfigured: () => state.smm };
});

vi.mock("@/lib/smm-catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/smm-catalog")>();
  return {
    ...actual,
    readBoostSnapshot: async () => {
      if (state.boostError) throw new Error(state.boostError);
      return state.boost;
    },
  };
});

vi.mock("@/lib/bitcall", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bitcall")>();
  return { ...actual, isBitcallConfigured: () => state.bitcall };
});

vi.mock("@/lib/accszone", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/accszone")>();
  return { ...actual, isAccsZoneConfigured: () => state.accszone };
});

vi.mock("@/lib/manual-catalog", () => ({ availableManualProducts: () => Array(state.manual).fill({}) }));

import { buildStockReport } from "@/lib/stock-live";
import { laneHeadline } from "@/lib/stock-report";

function snapshot() {
  return {
    sms: [{ id: "s1", name: "WhatsApp", country: "ng", priceNgn: 900, stock: 15 }],
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

  it("says 'feed not configured' rather than 'out of stock' when a key is missing", async () => {
    state.fleexa = false;
    state.bulkacc = false;
    state.smm = false;
    const { lanes } = await buildStockReport();
    for (const id of ["numbers", "rentals", "accounts", "boosts"]) {
      const lane = lanes.find((entry) => entry.lane === id)!;
      expect(lane.connected, id).toBe(false);
      expect(lane.error).toBe("feed not configured");
    }
  });

  it("stops reporting email inboxes as stock once the feed stops answering", async () => {
    state.snapshot = { ...snapshot(), email: [] };
    const { lanes } = await buildStockReport();
    const email = lanes.find((lane) => lane.lane === "email-otp")!;
    expect(email.lines).toEqual([]);
    expect(laneHeadline(email)).toBe("the feed returned nothing");
  });

  it("counts hand-prepared listings alongside the feed without pretending they are stock", async () => {
    state.manual = 2;
    const { lanes } = await buildStockReport();
    expect(lanes.find((lane) => lane.lane === "accounts")!.error).toContain("2 hand-prepared");
  });

  it("names a connected marketplace that is not the active source", async () => {
    state.accszone = true;
    const { lanes } = await buildStockReport();
    const line = lanes
      .find((lane) => lane.lane === "accounts")!
      .lines.find((entry) => entry.id === "alternate-marketplace");
    expect(line?.state).toBe("not-sold");
    expect(line?.note).toMatch(/not the active source/i);
  });

  it("marks eSIM as connected but not sold, so it never counts as buyable", async () => {
    const { lanes } = await buildStockReport();
    const esim = lanes.find((lane) => lane.lane === "esim")!;
    expect(esim.connected).toBe(true);
    expect(esim.sellable).toBe(0);
    expect(esim.lines[0].state).toBe("not-sold");
  });
});
