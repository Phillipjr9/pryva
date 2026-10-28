import { describe, it, expect } from "vitest";
import { calculateBulkOrder, getBulkDiscountMessage } from "@/lib/bulk-orders";
import { plans } from "@/lib/catalog";

describe("Bulk Orders Extended", () => {
  describe("calculateBulkOrder edge cases", () => {
    it("should handle empty items array", () => {
      const result = calculateBulkOrder([]);
      expect(result.items.length).toBe(0);
      expect(result.subtotal).toBe(0);
      expect(result.discount).toBe(0);
      expect(result.total).toBe(0);
    });

    it("rejects invalid product slugs instead of silently pricing an incomplete basket", () => {
      const items = [{ productSlug: "invalid-slug", quantity: 10 }];
      expect(() => calculateBulkOrder(items)).toThrow("Invalid bulk-order item");
    });

    it("should calculate correctly for mixed products at discount threshold", () => {
      const items = [
        { productSlug: "vn-ng", quantity: 5 },
        { productSlug: "vn-us", quantity: 5 },
      ];
      const result = calculateBulkOrder(items);
      expect(result.items.length).toBe(2);
      expect(result.discountPercent).toBe(5);
      expect(result.total).toBe(result.subtotal - result.discount);
    });

    it("should apply 10% discount at exactly 20 items", () => {
      const items = [
        { productSlug: "vn-ng", quantity: 20 },
      ];
      const result = calculateBulkOrder(items);
      expect(result.discountPercent).toBe(10);
    });

    it("should not exceed 10% discount", () => {
      const items = [
        { productSlug: "vn-ng", quantity: 100 },
      ];
      const result = calculateBulkOrder(items);
      expect(result.discountPercent).toBe(10);
    });

    it("should calculate subtotals correctly for each item", () => {
      const plan = plans.find((p) => p.slug === "vn-ng");
      if (!plan) throw new Error("Test plan not found");

      const items = [
        { productSlug: "vn-ng", quantity: 3 },
      ];
      const result = calculateBulkOrder(items);
      expect(result.items[0].subtotal).toBe(plan.price * 3);
      expect(result.items[0].unitPrice).toBe(plan.price);
    });
  });

  describe("getBulkDiscountMessage edge cases", () => {
    it("should return null for 0 items", () => {
      expect(getBulkDiscountMessage(0)).toBeNull();
    });

    it("should return null for negative quantity", () => {
      expect(getBulkDiscountMessage(-5)).toBeNull();
    });

    it("should show correct progress for 9 items", () => {
      const message = getBulkDiscountMessage(9);
      expect(message).toContain("1 more item");
      expect(message).toContain("5% discount");
    });

    it("should show 5% message for exactly 10 items", () => {
      const message = getBulkDiscountMessage(10);
      expect(message).toContain("5% discount");
    });

    it("should show 10% message for exactly 20 items", () => {
      const message = getBulkDiscountMessage(20);
      expect(message).toContain("10% discount");
    });

    it("should show 10% message for 100+ items", () => {
      const message = getBulkDiscountMessage(100);
      expect(message).toContain("10% discount");
    });
  });
});
