import { describe, expect, it } from "vitest";
import { parseExportRange } from "@/lib/export-range";

/**
 * A period on a ledger export.
 *
 * The whole point is that a date means a Lagos day, not a UTC day. Nigeria is
 * UTC+1 with no DST, so `2026-01-31` starts at 23:00 UTC on the 30th and ends at
 * 22:59:59.999 UTC on the 31st. An implementation that treats the date as UTC
 * midnight is an hour wrong for every row near a boundary — and wrong in the
 * direction that quietly drops the first hour of the customer's month.
 */
describe("parsing an export period", () => {
  it("treats both dates as whole Lagos days, inclusive", () => {
    const range = parseExportRange("2026-01-01", "2026-01-31");
    expect(range.ok).toBe(true);
    if (!range.ok) return;

    expect(range.start?.toISOString()).toBe("2025-12-31T23:00:00.000Z");
    expect(range.end?.toISOString()).toBe("2026-01-31T22:59:59.999Z");
    expect(range.label).toBe("2026-01-01_to_2026-01-31");
  });

  it("accepts one bound at a time and labels it that way", () => {
    const from = parseExportRange("2026-03-01", null);
    expect(from.ok && from.start?.toISOString()).toBe("2026-02-28T23:00:00.000Z");
    expect(from.ok && from.end).toBe(null);
    expect(from.ok && from.label).toBe("from_2026-03-01");

    const to = parseExportRange(null, "2026-03-31");
    expect(to.ok && to.start).toBe(null);
    expect(to.ok && to.end?.toISOString()).toBe("2026-03-31T22:59:59.999Z");
    expect(to.ok && to.label).toBe("to_2026-03-31");
  });

  it("treats a single day as that day, not as an empty range", () => {
    const range = parseExportRange("2026-02-14", "2026-02-14");
    expect(range.ok).toBe(true);
    if (!range.ok) return;
    expect(range.start?.toISOString()).toBe("2026-02-13T23:00:00.000Z");
    expect(range.end?.toISOString()).toBe("2026-02-14T22:59:59.999Z");
    expect(range.end!.getTime()).toBeGreaterThan(range.start!.getTime());
  });

  it("means 'everything' when nothing is given", () => {
    for (const [start, end] of [[null, null], ["", ""], ["  ", " "]] as const) {
      const range = parseExportRange(start, end);
      expect(range.ok).toBe(true);
      if (!range.ok) continue;
      expect(range.start).toBe(null);
      expect(range.end).toBe(null);
      expect(range.label).toBe(null);
    }
  });

  it("refuses a date it cannot read", () => {
    for (const bad of ["31-01-2026", "2026-1-1", "2026-13-01", "2026-00-10", "2026-02-30", "yesterday", "2026-01-01T00:00:00Z"]) {
      const range = parseExportRange(bad, null);
      expect(range.ok).toBe(false);
      if (!range.ok) expect(range.error).toContain("YYYY-MM-DD");
    }
  });

  it("refuses a period that runs backwards", () => {
    const range = parseExportRange("2026-05-02", "2026-05-01");
    expect(range.ok).toBe(false);
    if (!range.ok) expect(range.error).toBe("The start date is after the end date.");
  });

  it("keeps leap days and year boundaries straight", () => {
    const leap = parseExportRange("2028-02-29", "2028-02-29");
    expect(leap.ok).toBe(true);
    const newYear = parseExportRange("2025-12-31", "2026-01-01");
    expect(newYear.ok).toBe(true);
    if (!newYear.ok) return;
    // Two Lagos days, ending on the last millisecond of the second one.
    expect(newYear.end!.getTime() - newYear.start!.getTime()).toBe(2 * 24 * 60 * 60 * 1000 - 1);
  });
});
