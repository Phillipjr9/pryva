import { describe, expect, it } from "vitest";
import {
  FRESH_DELIVERY_DAYS,
  SERVICE_LANES,
  countingSummary,
  summariseLane,
  type OrderTally,
} from "@/lib/service-coverage";

/**
 * The coverage verdict.
 *
 * "Configured" is not "working": a key that has never fulfilled an order proves
 * nothing, and a lane whose last delivery was a month ago is not healthy just
 * because a variable is still set. These tests pin the evidence rules, because
 * the whole page exists to stop the owner mistaking one for the other.
 */

const numbers = SERVICE_LANES.find((lane) => lane.id === "numbers")!;

const DAY = 86_400_000;
const now = new Date("2026-10-31T12:00:00Z");

function tally(overrides: Partial<OrderTally> = {}): OrderTally {
  return {
    provider: "fleexa",
    status: "delivered",
    total: 1,
    withCode: 0,
    latest: new Date(now.getTime() - DAY),
    ...overrides,
  };
}

const summarise = (tallies: OrderTally[], extra: { stale?: number; configured?: boolean } = {}) =>
  summariseLane({
    spec: numbers,
    tallies,
    stale: extra.stale ?? 0,
    configured: extra.configured ?? true,
    now,
  });

describe("a lane that has never sold anything", () => {
  it("is untested rather than healthy, because a key is not a delivery", () => {
    const lane = summarise([]);
    expect(lane.verdict).toBe("untested");
    expect(lane.orders).toBe(0);
    expect(lane.headline).toMatch(/nothing has ever been bought/i);
  });
});

describe("a lane with no credential", () => {
  it("reads as not for sale and says the gates refuse money", () => {
    const lane = summarise([], { configured: false });
    expect(lane.verdict).toBe("unavailable");
    expect(lane.headline).toMatch(/refuse to take money/i);
  });

  it("stays unavailable even when old orders exist", () => {
    // A lane switched off after trading must not read as healthy.
    const lane = summarise([tally()], { configured: false });
    expect(lane.verdict).toBe("unavailable");
  });
});

describe("a lane that is delivering", () => {
  it("is healthy when something reached a customer inside the window", () => {
    const lane = summarise([tally({ total: 4 })]);
    expect(lane.verdict).toBe("delivering");
    expect(lane.delivered).toBe(4);
    expect(lane.daysSinceDelivery).toBe(1);
  });

  it("counts an issued number as delivery evidence, because the customer has it", () => {
    const lane = summarise([tally({ status: "active", total: 3, withCode: 3, latest: new Date(now.getTime() - 3_600_000) })]);
    expect(lane.issued).toBe(3);
    expect(lane.verdict).toBe("delivering");
  });

  it("does not count an active order without a code, which has delivered nothing", () => {
    // This is the boost case: accepted by the panel, nothing provided yet.
    const lane = summarise([tally({ status: "active", total: 2, withCode: 0 })]);
    expect(lane.issued).toBe(0);
    expect(lane.verdict).toBe("needs-attention");
    expect(lane.running).toBe(2);
  });
});

describe("a lane that is not working", () => {
  it("needs attention when orders exist and none was ever delivered", () => {
    const lane = summarise([
      tally({ status: "refunded", total: 3 }),
      tally({ status: "review", total: 1 }),
    ]);
    expect(lane.verdict).toBe("needs-attention");
    expect(lane.failed).toBe(4);
    expect(lane.headline).toMatch(/none reached a customer/i);
  });

  it("needs attention when the last delivery is older than the window", () => {
    const lane = summarise([tally({ latest: new Date(now.getTime() - (FRESH_DELIVERY_DAYS + 2) * DAY) })]);
    expect(lane.verdict).toBe("needs-attention");
    expect(lane.daysSinceDelivery).toBe(FRESH_DELIVERY_DAYS + 2);
    expect(lane.headline).toMatch(/nothing reached a customer/i);
  });

  it("surfaces stuck orders so a queue that stopped moving is visible", () => {
    const lane = summarise([tally({ status: "processing", total: 2 })], { stale: 2 });
    expect(lane.stale).toBe(2);
    expect(lane.verdict).toBe("needs-attention");
  });
});

describe("lane bookkeeping", () => {
  it("ignores orders that belong to a different lane", () => {
    const lane = summarise([tally({ provider: "smm", status: "delivered", total: 9 })]);
    expect(lane.orders).toBe(0);
    expect(lane.verdict).toBe("untested");
  });

  it("counts in-flight work separately from delivered and failed", () => {
    const lane = summarise([
      tally({ status: "delivered", total: 2 }),
      tally({ status: "processing", total: 1 }),
      tally({ status: "refunded", total: 3 }),
    ]);
    expect(lane.orders).toBe(6);
    expect(lane.delivered).toBe(2);
    expect(lane.running).toBe(1);
    expect(lane.failed).toBe(3);
  });

  it("summarises how many lanes are delivering right now", () => {
    const healthy = summarise([tally()]);
    const untested = summariseLane({
      spec: SERVICE_LANES.find((lane) => lane.id === "boosts")!,
      tallies: [],
      stale: 0,
      configured: true,
      now,
    });
    expect(countingSummary([healthy, untested])).toEqual({ total: 2, healthy: 1 });
  });
});
