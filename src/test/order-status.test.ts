import { describe, it, expect } from "vitest";
import { orderStatusLabel } from "@/lib/catalog";

describe("Order Status", () => {
  describe("orderStatusLabel", () => {
    it("should return correct labels for known statuses", () => {
      expect(orderStatusLabel("active")).toBe("Active");
      expect(orderStatusLabel("delivered")).toBe("Code received");
      expect(orderStatusLabel("refunded")).toBe("Refunded");
      expect(orderStatusLabel("expired")).toBe("Expired");
    });

    it("should return raw status for unknown statuses", () => {
      expect(orderStatusLabel("pending")).toBe("pending");
      expect(orderStatusLabel("processing")).toBe("processing");
      expect(orderStatusLabel("custom_status")).toBe("custom_status");
    });

    it("should handle empty string", () => {
      expect(orderStatusLabel("")).toBe("");
    });
  });
});
