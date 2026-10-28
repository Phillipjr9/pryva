import { describe, it, expect } from "vitest";
import { calculateBulkOrder, getBulkDiscountMessage } from "@/lib/bulk-orders";

describe("Bulk Orders", () => {
  describe("calculateBulkOrder", () => {
    it("should calculate order without discount for less than 10 items", () => {
      const items = [
        { productSlug: "vn-ng", quantity: 5 },
      ];
      const result = calculateBulkOrder(items);
      expect(result.discountPercent).toBe(0);
      expect(result.discount).toBe(0);
      expect(result.total).toBe(result.subtotal);
    });

    it("should apply 5% discount for 10+ items", () => {
      const items = [
        { productSlug: "vn-ng", quantity: 10 },
      ];
      const result = calculateBulkOrder(items);
      expect(result.discountPercent).toBe(5);
      expect(result.discount).toBeGreaterThan(0);
      expect(result.total).toBeLessThan(result.subtotal);
    });

    it("should apply 10% discount for 20+ items", () => {
      const items = [
        { productSlug: "vn-ng", quantity: 20 },
      ];
      const result = calculateBulkOrder(items);
      expect(result.discountPercent).toBe(10);
      expect(result.discount).toBeGreaterThan(0);
      expect(result.total).toBeLessThan(result.subtotal);
    });

    it("rejects unknown products and non-positive or fractional quantities", () => {
      for (const item of [
        { productSlug: "vn-ng", quantity: -1 },
        { productSlug: "vn-ng", quantity: 0 },
        { productSlug: "vn-ng", quantity: 1.5 },
        { productSlug: "not-a-plan", quantity: 10 },
      ]) {
        expect(() => calculateBulkOrder([item])).toThrow("Invalid bulk-order item");
      }
    });

    it("should handle multiple products", () => {
      const items = [
        { productSlug: "vn-ng", quantity: 5 },
        { productSlug: "vn-us", quantity: 5 },
      ];
      const result = calculateBulkOrder(items);
      expect(result.items.length).toBe(2);
      expect(result.subtotal).toBeGreaterThan(0);
    });
  });

  describe("getBulkDiscountMessage", () => {
    it("should return null for less than 5 items", () => {
      expect(getBulkDiscountMessage(3)).toBeNull();
    });

    it("should show progress message for 5-9 items", () => {
      const message = getBulkDiscountMessage(7);
      expect(message).toContain("3 more items");
      expect(message).toContain("5% discount");
    });

    it("should show 5% discount message for 10-19 items", () => {
      const message = getBulkDiscountMessage(15);
      expect(message).toContain("5% discount");
    });

    it("should show 10% discount message for 20+ items", () => {
      const message = getBulkDiscountMessage(25);
      expect(message).toContain("10% discount");
    });
  });
});
