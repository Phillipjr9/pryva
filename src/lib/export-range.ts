/**
 * What period a ledger export covers.
 *
 * The export used to be all-or-nothing: a customer reconciling one month had to
 * download every row they had ever written and cut it themselves, and the CSV
 * filename said only the day it was produced — so two exports of different months
 * were indistinguishable once saved.
 *
 * Two rules make the answer unambiguous:
 *
 *  1. A date means a *whole day in Lagos*, because that is the day the customer
 *     lived through. Parsing `2026-01-31` as UTC midnight would silently exclude
 *     the first hour of the 1st (which is still the 31st locally) and would be
 *     wrong by an hour for the whole ledger. Nigeria is UTC+1 year-round, with no
 *     daylight saving, so the offset is a constant rather than a timezone lookup —
 *     when that stops being true this constant is the one thing to change.
 *  2. Nothing supplied means everything. An absent bound is not an error, it is
 *     "no bound", which is what the button did before ranges existed and what a
 *     customer pressing it without touching the dates expects.
 */

/** Nigeria is UTC+1 all year; there is no DST to account for. */
export const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type ExportRangeOk = {
  ok: true;
  /** First instant included, or null for "from the beginning". */
  start: Date | null;
  /** Last instant included, or null for "until now". */
  end: Date | null;
  /** Filename fragment, e.g. `2026-01-01_to_2026-01-31`. Null when unbounded. */
  label: string | null;
};

export type ExportRange = ExportRangeOk | { ok: false; error: string };

function parseDay(raw: string): Date | null {
  const match = DATE_PATTERN.exec(raw);
  if (!match) return null;
  const [, year, month, day] = match;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const midnightUtc = Date.UTC(y, m - 1, d);
  // Round-trip through a real date: 2026-02-30 becomes 2026-03-02 at UTC
  // midnight, which no longer matches, so impossible days are refused instead of
  // silently shifted into a neighbouring month.
  const check = new Date(midnightUtc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return check;
}

/**
 * `startDate` / `endDate` are `YYYY-MM-DD` in Lagos time, both inclusive.
 * Anything else is refused with a message safe to show a customer.
 */
export function parseExportRange(startRaw: string | null, endRaw: string | null): ExportRange {
  const startText = startRaw?.trim() ?? "";
  const endText = endRaw?.trim() ?? "";

  const startDay = startText ? parseDay(startText) : null;
  if (startText && !startDay) return { ok: false, error: "Start date must be written as YYYY-MM-DD." };
  const endDay = endText ? parseDay(endText) : null;
  if (endText && !endDay) return { ok: false, error: "End date must be written as YYYY-MM-DD." };

  const start = startDay ? new Date(startDay.getTime() - LAGOS_OFFSET_MS) : null;
  // The last millisecond of the chosen day, in Lagos: midnight of the next day
  // minus one, mapped back to UTC.
  const end = endDay ? new Date(endDay.getTime() + DAY_MS - 1 - LAGOS_OFFSET_MS) : null;

  if (start && end && start.getTime() > end.getTime()) {
    return { ok: false, error: "The start date is after the end date." };
  }

  const label = start && end
    ? `${startText}_to_${endText}`
    : start
      ? `from_${startText}`
      : end
        ? `to_${endText}`
        : null;

  return { ok: true, start, end, label };
}
