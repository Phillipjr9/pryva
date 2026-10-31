import { describe, expect, it } from "vitest";

import type { BulkaccProduct } from "@/lib/bulkacc";
import type { FleexaRentArea, FleexaSmsService } from "@/lib/fleexa";
import { plans } from "@/lib/catalog";
import { fulfilmentIntent } from "@/lib/fulfillment";
import type { SmmService } from "@/lib/smm-panel";
import {
  accountProductLines,
  boostLines,
  laneHeadline,
  numberPlanLines,
  rentalPlanLines,
  summariseLane,
} from "@/lib/stock-report";

/**
 * What the stock page is allowed to claim.
 *
 * Three mistakes would each make the page worse than no page: calling a product
 * out of stock when the feed simply declined to count it, calling a lane healthy
 * when the feed never answered, and hiding the difference between "down" and
 * "connected but nothing priced". Each one is pinned below.
 */

const sellable = plans.flatMap((plan) => {
  const intent = fulfilmentIntent(plan.slug);
  return intent ? [{ plan, intent }] : [];
});

function sms(overrides: Partial<FleexaSmsService> = {}): FleexaSmsService {
  return { id: "s1", name: "WhatsApp", country: "ng", priceNgn: 900, stock: 12, ...overrides };
}

function area(overrides: Partial<FleexaRentArea> = {}): FleexaRentArea {
  return { id: "a1", country: "ng", pricePerMonthNgn: 20_000, stock: 4, ...overrides };
}

function product(overrides: Partial<BulkaccProduct> = {}): BulkaccProduct {
  return {
    code: "P1",
    name: "Netflix 1 month",
    description: null,
    groupName: "Netflix",
    categoryName: "Premium",
    inStock: 20,
    min: 1,
    priceMicros: 1_500_000,
    ...overrides,
  };
}

function service(overrides: Partial<SmmService> = {}): SmmService {
  return {
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
    ...overrides,
  };
}

describe("number plans against a live catalog", () => {
  it("reports the units the feed counted", () => {
    const lines = numberPlanLines(sellable.filter((entry) => entry.plan.slug === "vn-ng"), [
      sms({ stock: 7 }),
      sms({ id: "s2", stock: 5 }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ id: "vn-ng", state: "in-stock", stock: 12 });
  });

  it("says 'not listed' when the feed has no number for that destination", () => {
    const lines = numberPlanLines(sellable.filter((entry) => entry.plan.slug === "vn-ng"), []);
    expect(lines[0].state).toBe("no-match");
    expect(lines[0].note).toMatch(/lists no number/i);
  });

  it("does not invent inventory the feed never reported", () => {
    const lines = numberPlanLines(sellable.filter((entry) => entry.plan.slug === "vn-ng"), [
      sms({ stock: null }),
    ]);
    expect(lines[0].state).toBe("unknown");
    expect(lines[0].stock).toBeNull();
  });

  it("calls a counted zero out of stock", () => {
    const lines = numberPlanLines(sellable.filter((entry) => entry.plan.slug === "vn-ng"), [
      sms({ stock: 0 }),
    ]);
    expect(lines[0].state).toBe("out-of-stock");
  });

  it("marks a handful of units as low rather than healthy", () => {
    const lines = numberPlanLines(sellable.filter((entry) => entry.plan.slug === "vn-ng"), [
      sms({ stock: 3 }),
    ]);
    expect(lines[0].state).toBe("low");
  });

  it("covers every plan the shop actually sells, not just the ones in stock", () => {
    const lines = numberPlanLines(sellable, []);
    const numberPlans = sellable.filter((entry) => entry.intent.kind === "sms").length;
    expect(lines).toHaveLength(numberPlans);
  });
});

describe("rentals against a live catalog", () => {
  it("reports a rental area's stock", () => {
    const lines = rentalPlanLines(sellable, [area({ stock: 2 })]);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toMatchObject({ state: "low", stock: 2 });
  });

  it("says 'not listed' when no area matches the destination", () => {
    const lines = rentalPlanLines(sellable, []);
    expect(lines.every((line) => line.state === "no-match")).toBe(true);
  });
});

describe("account listings", () => {
  it("counts a listing with stock as in stock", () => {
    expect(accountProductLines([product({ inStock: 20 })])[0].state).toBe("in-stock");
  });

  it("treats a listing below its minimum as out of stock", () => {
    expect(accountProductLines([product({ inStock: 0, min: 2 })])[0].state).toBe("out-of-stock");
  });

  it("keeps 'the feed did not say' distinct from zero", () => {
    expect(accountProductLines([product({ inStock: null })])[0].state).toBe("unknown");
  });

  it("caps a long catalog instead of rendering a thousand rows", () => {
    const many = Array.from({ length: 60 }, (_, index) => product({ code: `P${index}` }));
    expect(accountProductLines(many, 25)).toHaveLength(25);
  });
});

describe("boosts", () => {
  it("reports an orderable listing with its range instead of fake inventory", () => {
    const [line] = boostLines([service()], "NGN");
    expect(line.state).toBe("in-stock");
    expect(line.stock).toBeNull();
    expect(line.note).toContain("100–10000");
  });

  it("says so when a feed answers but nothing can be priced", () => {
    // USD panel with no conversion rate configured: the shop refuses, the feed is fine.
    const lines = boostLines([service({ currency: "USD" })], null);
    expect(lines).toHaveLength(1);
    expect(lines[0].state).toBe("unpriced");
    expect(lines[0].note).toMatch(/currency rate or markup/i);
  });

  it("ignores feed rows the shop does not sell", () => {
    const lines = boostLines([service({ name: "Instagram Story Poll Votes", category: "Instagram" })], "NGN");
    expect(lines).toEqual([]);
  });
});

describe("lane summaries", () => {
  it("counts only buyable lines", () => {
    const lane = summariseLane("numbers", "Virtual numbers", [
      { id: "a", label: "A", state: "in-stock", stock: 3, note: "" },
      { id: "b", label: "B", state: "unknown", stock: null, note: "" },
      { id: "c", label: "C", state: "no-match", stock: null, note: "" },
    ]);
    expect(lane.sellable).toBe(1);
    expect(laneHeadline(lane)).toBe("1 of 3 buyable now");
  });

  it("puts the feed's own error ahead of any count", () => {
    const lane = summariseLane("boosts", "Boosts", [], { connected: false, error: "timed out" });
    expect(laneHeadline(lane)).toBe("timed out");
  });

  it("distinguishes 'connected but empty' from 'not connected'", () => {
    expect(laneHeadline(summariseLane("accounts", "Accounts", []))).toBe("the feed returned nothing");
    expect(laneHeadline(summariseLane("accounts", "Accounts", [], { connected: false }))).toBe(
      "feed not connected",
    );
  });
});
