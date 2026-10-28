import { describe, expect, it } from "vitest";
import { walletEntryDirection, walletEntrySign } from "@/lib/wallet-activity";

describe("wallet activity directions", () => {
  it.each([
    ["credit", "in", "+"], ["refund", "in", "+"],
    ["debit", "out", "−"], ["withdrawal", "out", "−"],
    ["unknown", "unknown", ""],
  ])("classifies %s without mistaking deductions for credits", (type, direction, sign) => {
    expect(walletEntryDirection(type)).toBe(direction);
    expect(walletEntrySign(type)).toBe(sign);
  });
});
