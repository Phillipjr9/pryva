import { describe, expect, it } from "vitest";
import { ageHours, ageSeverity, formatAge } from "@/lib/reconciliation-queue";

/**
 * The queue's only arithmetic, and the two ways it can go wrong in production:
 * a clock ahead of ours (negative age, which would sort an item above older
 * ones) and a broken timestamp (NaN, which compares false against every
 * threshold and hides the item entirely).
 */
describe("reconciliation queue ageing", () => {
  const now = new Date("2026-10-30T12:00:00Z");

  it("clamps a future timestamp to zero instead of going negative", () => {
    expect(ageHours(new Date("2026-10-30T12:05:00Z"), now)).toBe(0);
  });

  it("treats a missing or unparseable date as new, never as NaN", () => {
    expect(ageHours(null, now)).toBe(0);
    expect(ageHours(undefined, now)).toBe(0);
    expect(ageHours("not a date", now)).toBe(0);
    expect(Number.isNaN(ageHours("not a date", now))).toBe(false);
  });

  it("measures hours for a real timestamp", () => {
    expect(ageHours(new Date("2026-10-30T09:00:00Z"), now)).toBe(3);
  });

  it("calls under an hour fresh, under a day a watch, and a day or more urgent", () => {
    expect(ageSeverity(0.9)).toBe("fresh");
    expect(ageSeverity(1)).toBe("watch");
    expect(ageSeverity(23.9)).toBe("watch");
    expect(ageSeverity(24)).toBe("urgent");
    expect(ageSeverity(Number.NaN)).toBe("fresh");
  });

  it("formats a duration without inventing precision", () => {
    expect(formatAge(0.5)).toBe("30m");
    expect(formatAge(6.9)).toBe("6h");
    expect(formatAge(72)).toBe("3d");
    expect(formatAge(0)).toBe("just now");
  });
});
