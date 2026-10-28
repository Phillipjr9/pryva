import { describe, expect, it } from "vitest";
import { MAX_WITHDRAWAL, maxWithdrawalForBalance, withdrawalFee } from "@/lib/withdrawal";

describe("withdrawal fees and maximum payout", () => {
  it("charges a 1% whole-naira fee in addition only above ₦5,000", () => {
    expect(withdrawalFee(5000)).toBe(0);
    expect(withdrawalFee(5001)).toBe(50);
    expect(withdrawalFee(6000)).toBe(60);
    expect(withdrawalFee(5_000_000)).toBe(50_000);
  });

  it("chooses the largest affordable payout including the fee and server cap", () => {
    for (const balance of [0, 999, 5000, 5050, 5051, 6000, 10000, 1_000_000, 9_000_000]) {
      const max = maxWithdrawalForBalance(balance);
      expect(max + withdrawalFee(max)).toBeLessThanOrEqual(balance);
      expect(max).toBeLessThanOrEqual(MAX_WITHDRAWAL);
      if (max < MAX_WITHDRAWAL) expect(max + 1 + withdrawalFee(max + 1)).toBeGreaterThan(balance);
    }
    expect(maxWithdrawalForBalance(6000)).toBe(5941);
  });
});
