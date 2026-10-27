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

    it("should handle year rollover for monthly", () => {
      const december = new Date(2024, 11, 15); // December 15, 2024
      const next = calculateNextRun("monthly", december);
      expect(next.getFullYear()).toBe(2025);
      expect(next.getMonth()).toBe(0);
    });

    it("clamps month-end dates to the final day of the next month", () => {
      const next = calculateNextRun("monthly", new Date(2024, 0, 31));
      expect(next.getFullYear()).toBe(2024);
      expect(next.getMonth()).toBe(1);
      expect(next.getDate()).toBe(29);
    });
  });
});
