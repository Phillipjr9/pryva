import { describe, it, expect } from "vitest";
import { generateCode, isRefundEligible } from "@/lib/gift-cards";

describe("Gift Cards", () => {
  describe("generateCode", () => {
    it("should generate a valid gift card code", () => {
      const code = generateCode();
      expect(code).toMatch(/^PRYVA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    });

    it("should generate unique codes", () => {
      const codes = new Set<string>();
      for (let i = 0; i < 100; i++) {
        codes.add(generateCode());
      }
      expect(codes.size).toBe(100);
    });

    it("should not include ambiguous characters", () => {
      const code = generateCode();
      expect(code).not.toMatch(/[OI1]/);
    });
  });

  describe("isRefundEligible", () => {
    it("should return false for gift card purchases", () => {
      const transaction = {
        type: "debit",
        description: "Gift card purchase: PRYVA-ABCD-1234-WXYZ",
      };
      expect(isRefundEligible(transaction)).toBe(false);
    });

    it("should return true for regular purchases", () => {
      const transaction = {
        type: "debit",
        description: "Purchase: Nigeria number",
      };
      expect(isRefundEligible(transaction)).toBe(true);
    });

    it("should return true for credits", () => {
      const transaction = {
        type: "credit",
        description: "Wallet top-up",
      };
      expect(isRefundEligible(transaction)).toBe(true);
    });
  });
});
