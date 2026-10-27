import { describe, it, expect } from "vitest";
import { calculateNextRun, type Frequency } from "@/lib/scheduled-orders";

describe("Scheduled Orders", () => {
  describe("calculateNextRun", () => {
    it("should calculate daily frequency", () => {
      const now = new Date();
      const next = calculateNextRun("daily");
      const diff = next.getTime() - now.getTime();
      const days = diff / (1000 * 60 * 60 * 24);
      expect(days).toBeCloseTo(1, 0);
    });

    it("should calculate weekly frequency", () => {
      const now = new Date();
      const next = calculateNextRun("weekly");
      const diff = next.getTime() - now.getTime();
      const days = diff / (1000 * 60 * 60 * 24);
      expect(days).toBeCloseTo(7, 0);
    });

    it("should calculate biweekly frequency", () => {
      const now = new Date();
      const next = calculateNextRun("biweekly");
      const diff = next.getTime() - now.getTime();
      const days = diff / (1000 * 60 * 60 * 24);
      expect(days).toBeCloseTo(14, 0);
    });

    it("should calculate monthly frequency", () => {
      const now = new Date();
      const next = calculateNextRun("monthly");
      expect(next.getMonth()).toBe((now.getMonth() + 1) % 12);
    });

    it("should always move forward and roll over the year", () => {
      const now = new Date();
      const next = calculateNextRun("monthly");
      expect(next.getTime()).toBeGreaterThan(now.getTime());
      expect(next.getMonth()).toBe((now.getMonth() + 1) % 12);
      if (now.getMonth() === 11) {
        expect(next.getFullYear()).toBe(now.getFullYear() + 1);
      }
    });
  });
});
