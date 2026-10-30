import { describe, it, expect } from "vitest";
import { formatNaira, findPlan, findService, plansFor, services, plans } from "@/lib/catalog";

describe("Catalog Extended", () => {
  describe("formatNaira edge cases", () => {
    it("should handle very large numbers", () => {
      expect(formatNaira(1000000)).toBe("₦1,000,000");
      expect(formatNaira(999999999)).toBe("₦999,999,999");
    });

    it("should handle negative numbers", () => {
      expect(formatNaira(-500)).toBe("₦-500");
      expect(formatNaira(-1500)).toBe("₦-1,500");
    });

    it("should handle decimal numbers", () => {
      expect(formatNaira(1234.56)).toBe("₦1,235");
      expect(formatNaira(1234.49)).toBe("₦1,234");
    });
  });

  describe("services array", () => {
    it("should have at least 8 services", () => {
      expect(services.length).toBeGreaterThanOrEqual(8);
    });

    /**
     * `services` in catalog.ts derives `fromPrice` from a service's plan prices
     * but falls back to whatever the definition hand-set when there are no plans.
     * So deleting the four paid inbox tiers was not, by itself, enough to stop
     * the homepage advertising ₦790 for a temporary inbox -- the definition had
     * to carry no number either. This pins both halves of that.
     */
    it("leaves the free temporary inbox with no plans and no floor price", () => {
      const inbox = findService("email-otp");
      expect(inbox, "the email category is kept, only its paid tiers are gone").toBeDefined();
      expect(inbox!.fromPrice).toBeUndefined();
      expect(plansFor("email-otp")).toEqual([]);
    });

    it("should have all required fields for each service", () => {
      services.forEach((service) => {
        expect(service.slug).toBeDefined();
        expect(service.name).toBeDefined();
        expect(service.shortName).toBeDefined();
        expect(service.href).toBeDefined();
        expect(service.eyebrow).toBeDefined();
        expect(service.tagline).toBeDefined();
        expect(service.description).toBeDefined();
        expect(service.intro).toBeDefined();
        // Optional on purpose: a free service has no floor price, and every
        // consumer has to decide what to render instead of being handed a number.
        if (service.fromPrice !== undefined) expect(service.fromPrice).toBeGreaterThan(0);
        expect(service.unit).toBeDefined();
        expect(service.icon).toBeDefined();
        expect(service.highlights.length).toBeGreaterThan(0);
        expect(service.included.length).toBeGreaterThan(0);
        expect(service.goodFor.length).toBeGreaterThan(0);
        expect(service.faqs.length).toBeGreaterThan(0);
      });
    });

    it("should have unique slugs", () => {
      const slugs = services.map((s) => s.slug);
      const uniqueSlugs = new Set(slugs);
      expect(uniqueSlugs.size).toBe(slugs.length);
    });
  });

  describe("plans array", () => {
    it("should have at least 20 plans", () => {
      expect(plans.length).toBeGreaterThanOrEqual(20);
    });

    it("should have all required fields for each plan", () => {
      plans.forEach((plan) => {
        expect(plan.slug).toBeDefined();
        expect(plan.service).toBeDefined();
        expect(plan.name).toBeDefined();
        expect(plan.planLabel).toBeDefined();
        expect(plan.region).toBeDefined();
        expect(plan.duration).toBeDefined();
        expect(plan.price).toBeGreaterThan(0);
        expect(plan.features.length).toBeGreaterThan(0);
      });
    });

    it("should have unique slugs", () => {
      const slugs = plans.map((p) => p.slug);
      const uniqueSlugs = new Set(slugs);
      expect(uniqueSlugs.size).toBe(slugs.length);
    });

    it("should have valid service references", () => {
      const serviceSlugs = new Set(services.map((s) => s.slug));
      plans.forEach((plan) => {
        expect(serviceSlugs.has(plan.service)).toBe(true);
      });
    });
  });

  describe("findPlan edge cases", () => {
    it("should be case sensitive", () => {
      expect(findPlan("VN-NG")).toBeUndefined();
      expect(findPlan("vn-ng")).toBeDefined();
    });
  });

  describe("findService edge cases", () => {
    it("should be case sensitive", () => {
      expect(findService("NUMBERS")).toBeUndefined();
      expect(findService("numbers")).toBeDefined();
    });
  });

  describe("plansFor edge cases", () => {
    it("should return plans in consistent order", () => {
      const plans1 = plansFor("numbers");
      const plans2 = plansFor("numbers");
      expect(plans1).toEqual(plans2);
    });

    it("should not modify original plans array", () => {
      const originalLength = plans.length;
      plansFor("numbers");
      expect(plans.length).toBe(originalLength);
    });
  });
});
