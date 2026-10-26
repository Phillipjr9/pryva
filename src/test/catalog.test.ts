import { describe, it, expect } from "vitest";
import { formatNaira, findPlan, findService, plansFor } from "@/lib/catalog";

describe("Catalog", () => {
  describe("formatNaira", () => {
    it("should format small amounts correctly", () => {
      expect(formatNaira(500)).toBe("₦500");
      expect(formatNaira(1200)).toBe("₦1,200");
    });

    it("should format large amounts with commas", () => {
      expect(formatNaira(15000)).toBe("₦15,000");
      expect(formatNaira(500000)).toBe("₦500,000");
    });

    it("should handle zero", () => {
      expect(formatNaira(0)).toBe("₦0");
    });
  });

  describe("findPlan", () => {
    it("should find existing plans", () => {
      const plan = findPlan("vn-ng");
      expect(plan).toBeDefined();
      expect(plan?.name).toBe("Nigeria");
      expect(plan?.service).toBe("numbers");
    });

    it("should return undefined for non-existent plans", () => {
      expect(findPlan("non-existent")).toBeUndefined();
    });
  });

  describe("findService", () => {
    it("should find existing services", () => {
      const service = findService("numbers");
      expect(service).toBeDefined();
      expect(service?.name).toBe("Virtual Numbers");
    });

    it("should return undefined for non-existent services", () => {
      expect(findService("non-existent")).toBeUndefined();
    });
  });

  describe("plansFor", () => {
    it("should return plans for a specific service", () => {
      const numberPlans = plansFor("numbers");
      expect(numberPlans.length).toBeGreaterThan(0);
      expect(numberPlans.every((p) => p.service === "numbers")).toBe(true);
    });

    it("should return empty array for service with no plans", () => {
      const plans = plansFor("non-existent" as any);
      expect(plans).toEqual([]);
    });
  });
});
