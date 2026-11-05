/**
 * Age arithmetic for the reconciliation queue.
 *
 * Kept apart from the page so it can be tested without a database, and because
 * the three decisions it makes are the ones that matter:
 *
 *   * a clock that is ahead must not produce a negative age (a negative would
 *     sort an item above genuinely old ones and hide it);
 *   * an unparseable date must not produce NaN (NaN comparisons are all false,
 *     so an item with a broken timestamp would silently vanish from every bucket);
 *   * "old" means old enough that a customer has probably noticed.
 */

export type AgeSeverity = "fresh" | "watch" | "urgent";

/** Hours since `then`, clamped at zero. Unparseable input counts as zero (new). */
export function ageHours(then: Date | string | null | undefined, now: Date = new Date()): number {
  if (!then) return 0;
  const value = then instanceof Date ? then.getTime() : new Date(then).getTime();
  if (!Number.isFinite(value)) return 0;
  const hours = (now.getTime() - value) / 3_600_000;
  return Number.isFinite(hours) && hours > 0 ? hours : 0;
}

/**
 * Under an hour is normal processing. A day is where an ambiguous transfer or
 * supplier order stops being "in flight" and starts being an incident.
 */
export function ageSeverity(hours: number): AgeSeverity {
  if (!Number.isFinite(hours) || hours < 1) return "fresh";
  if (hours < 24) return "watch";
  return "urgent";
}

/** Compact, unambiguous duration: `45m`, `6h`, `3d`. */
export function formatAge(hours: number): string {
  if (!Number.isFinite(hours) || hours < 1 / 60) return "just now";
  if (hours < 1) return `${Math.floor(hours * 60)}m`;
  if (hours < 24) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
}
