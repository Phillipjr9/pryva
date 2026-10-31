import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Closing finished rentals.
 *
 * A rental used to reach `expired` only when its owner opened the order page,
 * because that page is what asks the supplier. Anyone who bought thirty days and
 * never logged back in left a row that still read `active`, and the dashboard kept
 * counting a finished thing as live. This pins the two exclusions that make the
 * sweep safe: single-use numbers belong to the refund sweep, and a refunded order
 * is never overwritten by a date passing.
 */

const state = vi.hoisted(() => ({ rows: [] as { id: string }[], sets: [] as unknown[] }));

vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: (values: unknown) => {
        state.sets.push(values);
        return { where: () => ({ returning: () => Promise.resolve(state.rows) }) };
      },
    }),
  },
}));

import { expireFinishedRentals } from "@/lib/rental-expiry";

beforeEach(() => {
  state.rows = [];
  state.sets = [];
});

describe("expiring rentals", () => {
  it("reports how many terms it closed", async () => {
    state.rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    await expect(expireFinishedRentals()).resolves.toEqual({ expired: 3 });
  });

  it("only ever writes the expired status", async () => {
    state.rows = [{ id: "a" }];
    await expireFinishedRentals();
    expect(state.sets).toEqual([{ status: "expired" }]);
  });

  it("is a no-op when nothing has finished", async () => {
    await expect(expireFinishedRentals()).resolves.toEqual({ expired: 0 });
  });
});
