import { describe, expect, it } from "vitest";
import { loyaltyLevelForOrders, loyaltyPriceNgn } from "@/lib/services/loyalty-policy";

describe("loyalty policy (not connected to checkout)", () => {
  it.each([
    [0, 1, 0], [4, 1, 0], [5, 2, 50], [14, 2, 50], [15, 3, 100],
    [29, 3, 100], [30, 4, 150], [59, 4, 150], [60, 5, 200],
  ])("maps %i eligible orders to level %i", (orders, level, bps) => {
    expect(loyaltyLevelForOrders(orders)).toMatchObject({ level, discountBasisPoints: bps });
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects an invalid count %s", (orders) => {
    expect(loyaltyLevelForOrders(orders)).toBeNull();
  });

  it("rounds conservatively and caps the discount at the independently verified floor", () => {
    expect(loyaltyPriceNgn({ undiscountedNgn: 10_000, minimumNgn: 9_000, eligibleOrders: 60 })).toBe(9_800);
    expect(loyaltyPriceNgn({ undiscountedNgn: 10_000, minimumNgn: 9_950, eligibleOrders: 60 })).toBe(9_950);
    expect(loyaltyPriceNgn({ undiscountedNgn: 115, minimumNgn: 115, eligibleOrders: 60 })).toBe(115);
    expect(loyaltyPriceNgn({ undiscountedNgn: 501, minimumNgn: 500, eligibleOrders: 5 })).toBe(500);
    expect(loyaltyPriceNgn({ undiscountedNgn: 501, minimumNgn: 500, eligibleOrders: 0 })).toBe(501);
  });

  it.each([
    { undiscountedNgn: 0, minimumNgn: 1, eligibleOrders: 60 },
    { undiscountedNgn: 100, minimumNgn: 101, eligibleOrders: 60 },
    { undiscountedNgn: 100.5, minimumNgn: 100, eligibleOrders: 60 },
    { undiscountedNgn: 100, minimumNgn: 0, eligibleOrders: 60 },
    { undiscountedNgn: 100, minimumNgn: 90, eligibleOrders: NaN },
  ])("fails closed when inputs are invalid: %o", (input) => {
    expect(loyaltyPriceNgn(input)).toBeNull();
  });
});
