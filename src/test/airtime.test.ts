import { describe, it, expect } from "vitest";
import {
  dataPlans,
  airtimePlans,
  AIRTIME_DENOMINATIONS,
  getDataPlansByProvider,
  findDataPlan,
  getAirtimePlansByProvider,
  findAirtimePlan,
  type AirtimeProvider,
} from "@/lib/airtime";

describe("Airtime & Mobile Data", () => {
  describe("dataPlans", () => {
    it("should have plans for all providers with consistent tiers", () => {
      const providers: AirtimeProvider[] = ["mtn", "airtel", "glo", "9mobile"];
      providers.forEach((provider) => {
        const plans = getDataPlansByProvider(provider);
        expect(plans.length).toBeGreaterThanOrEqual(8);
        const sizes = plans.map((p) => p.size);
        expect(sizes).toContain("500MB");
        expect(sizes).toContain("1GB");
        expect(sizes).toContain("2GB");
        expect(sizes).toContain("5GB");
        expect(sizes).toContain("10GB");
        expect(sizes).toContain("20GB");
      });
    });

    it("should have valid plan structure and unique IDs", () => {
      const ids = new Set<string>();
      dataPlans.forEach((plan) => {
        expect(plan.id).toBeDefined();
        expect(ids.has(plan.id)).toBe(false);
        ids.add(plan.id);
        expect(plan.provider).toBeDefined();
        expect(plan.name).toBeDefined();
        expect(plan.size).toBeDefined();
        expect(plan.duration).toBeDefined();
        expect(plan.price).toBeGreaterThan(0);
      });
      expect(ids.size).toBe(dataPlans.length);
    });
  });

  describe("getDataPlansByProvider", () => {
    it("should filter plans by provider", () => {
      const mtnPlans = getDataPlansByProvider("mtn");
      expect(mtnPlans.every((p) => p.provider === "mtn")).toBe(true);
      const airtelPlans = getDataPlansByProvider("airtel");
      expect(airtelPlans.every((p) => p.provider === "airtel")).toBe(true);
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

  describe("airtimePlans", () => {
    it("should provide airtime denominations across all 4 networks", () => {
      const providers: AirtimeProvider[] = ["mtn", "airtel", "glo", "9mobile"];
      providers.forEach((provider) => {
        const plans = getAirtimePlansByProvider(provider);
        expect(plans).toHaveLength(AIRTIME_DENOMINATIONS.length);
        const amounts = plans.map((p) => p.amount);
        expect(amounts).toEqual([...AIRTIME_DENOMINATIONS]);
      });
    });

    it("should find specific airtime plan by ID", () => {
      const plan = findAirtimePlan("mtn-airtime-1000");
      expect(plan).toBeDefined();
      expect(plan?.amount).toBe(1000);
      expect(plan?.provider).toBe("mtn");
    });
  });
});
