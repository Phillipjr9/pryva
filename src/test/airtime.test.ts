import { describe, it, expect } from "vitest";
import { dataPlans, getDataPlansByProvider, findDataPlan } from "@/lib/airtime";

describe("Airtime", () => {
  describe("dataPlans", () => {
    it("should have plans for all providers", () => {
      const providers = ["mtn", "airtel", "glo", "9mobile"];
      providers.forEach((provider) => {
        const plans = getDataPlansByProvider(provider as any);
        expect(plans.length).toBeGreaterThan(0);
      });
    });

    it("should have valid plan structure", () => {
      dataPlans.forEach((plan) => {
        expect(plan.id).toBeDefined();
        expect(plan.provider).toBeDefined();
        expect(plan.name).toBeDefined();
        expect(plan.size).toBeDefined();
        expect(plan.duration).toBeDefined();
        expect(plan.price).toBeGreaterThan(0);
      });
    });
  });

  describe("getDataPlansByProvider", () => {
    it("should filter plans by provider", () => {
      const mtnPlans = getDataPlansByProvider("mtn");
      expect(mtnPlans.every((p) => p.provider === "mtn")).toBe(true);
    });

    it("should return empty array for invalid provider", () => {
      const plans = getDataPlansByProvider("invalid" as any);
      expect(plans).toEqual([]);
    });
  });

  describe("findDataPlan", () => {
    it("should find existing plans", () => {
      const plan = findDataPlan("mtn-1gb");
      expect(plan).toBeDefined();
      expect(plan?.provider).toBe("mtn");
      expect(plan?.size).toBe("1GB");
    });

    it("should return undefined for non-existent plans", () => {
      expect(findDataPlan("non-existent")).toBeUndefined();
    });
  });
});
