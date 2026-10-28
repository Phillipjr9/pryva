/**
 * Pryva's own warranty promise, per product line.
 *
 * A customer only ever deals with Pryva, so a replacement claim lands here — not
 * with whoever supplied the account. The number of days is therefore Pryva's
 * policy decision, not a supplier's marketing line. It lives in one client-safe
 * table (no supplier identity anywhere in this module). A hand-prepared product
 * carries its own per-product value in `data/manual-catalog.json`, which wins.
 *
 * Deliberately absent: any claim that Pryva operates, owns or is partnered with
 * the platforms whose accounts are sold. The warranty covers replacement of a
 * delivered item that stops working inside the window.
 */

/** Fallback when a product line has no explicit warranty row. */
export const DEFAULT_WARRANTY_DAYS = Number(process.env.WARRANTY_DEFAULT_DAYS || 30);

/**
 * Warranty by Pryva-facing product group. Streaming sits highest because those
 * items are the ones customers re-check most often, and a replacement there is
 * cheap relative to the support cost of refusing one.
 */
const WARRANTY_DAYS_BY_GROUP: Record<string, number> = {
  Streaming: 120,
  Email: 30,
  Social: 30,
  Video: 60,
  "Apple ID": 30,
  Developer: 30,
  "AI tools": 30,
  Reviews: 30,
  Publishing: 30,
  "Web profiles": 30,
  Gaming: 30,
  Other: 30,
};

/**
 * The groups that have an explicit warranty row.
 *
 * Exported so a test can check this against the group labels the catalog layer
 * emits. A label with no row here silently inherits the 30-day default, which is
 * how a streaming product would end up promising one month instead of four
 * without anyone deciding that.
 */
export const WARRANTY_GROUPS: readonly string[] = Object.freeze(
  Object.keys(WARRANTY_DAYS_BY_GROUP).sort(),
);

/** Warranty days for a group label, clamped to something sane. */
export function warrantyDaysForGroup(group: string | null | undefined): number {
  if (typeof group !== "string") return DEFAULT_WARRANTY_DAYS;
  const days = WARRANTY_DAYS_BY_GROUP[group];
  return Number.isSafeInteger(days) && days > 0 && days <= 365 ? days : DEFAULT_WARRANTY_DAYS;
}

/** Human label, or null when there is nothing honest to promise. */
export function warrantyLabel(days: number | null | undefined): string | null {
  if (!Number.isSafeInteger(days) || (days as number) <= 0) return null;
  const value = days as number;
  if (value >= 60 && value % 30 === 0) {
    const months = value / 30;
    return `${months}-month replacement warranty`;
  }
  return `${value}-day replacement warranty`;
}

/** Short badge text for a listing card. */
export function warrantyBadge(days: number | null | undefined): string | null {
  if (!Number.isSafeInteger(days) || (days as number) <= 0) return null;
  const value = days as number;
  if (value >= 60 && value % 30 === 0) return `${value / 30}-month warranty`;
  return `${value}-day warranty`;
}

/**
 * How an order reaches the customer.
 *
 * `instant`  — delivered automatically the moment the purchase is confirmed.
 * `manual`   — the item is sourced and confirmed by hand, so delivery takes
 *              longer and the order waits in a fulfilment queue first.
 */
export type FulfilmentMode = "instant" | "manual";

export function fulfilmentLabel(mode: FulfilmentMode): string {
  return mode === "instant" ? "Instant delivery" : "Delivered after confirmation";
}
