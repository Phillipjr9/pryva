/**
 * Gross-margin protection for live purchases.
 *
 * Pryva fulfils before it debits, and fulfilment spends the owner's real
 * provider balance. Nothing else in the purchase path compares what the customer
 * pays against what the unit actually costs, so a provider price that drifts
 * above the selling price would turn every sale into a silent loss -- one that
 * gets worse as volume grows and that no test would catch.
 *
 * The floor sits deliberately below the catalog's 30-50% target band so ordinary
 * drift still sells, while a genuinely loss-making sale is refused outright.
 */

const DEFAULT_MIN_MARGIN_RATIO = 0.1;

/**
 * The floor every sale must clear, as a ratio of the selling price.
 *
 * Exported so the admin margin view measures realised margin against the same
 * number the purchase guard enforces. A second copy of this threshold would
 * eventually disagree with the first, and a report that uses a different floor
 * than the code is worse than no report.
 */
export function configuredFloor(): number {
  const raw = process.env.MIN_MARGIN_RATIO?.trim();
  if (!raw) return DEFAULT_MIN_MARGIN_RATIO;
  const parsed = Number(raw);
  // A malformed or out-of-range value must never widen what is allowed to sell:
  // fall back to the built-in floor rather than trusting it.
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 1) return DEFAULT_MIN_MARGIN_RATIO;
  return parsed;
}

export type MarginCheck =
  | { ok: true; costNgn: number; priceNgn: number; marginNgn: number; marginRatio: number }
  | {
      ok: false;
      /** COST_UNKNOWN: the provider did not tell us the price, so we cannot know. */
      code: "COST_UNKNOWN" | "UNPROFITABLE";
      costNgn: number | null;
      priceNgn: number;
      marginNgn: number | null;
    };

/**
 * Pure: given what we charge and what the unit costs, decide whether to sell.
 *
 * A null or non-positive cost is refused. Failing open here would mean buying
 * stock at an unknown price, which is precisely the risk this module exists to
 * prevent -- and the provider's price fields are nullable in practice.
 */
export function checkMargin(priceNgn: number, costNgn: number | null): MarginCheck {
  if (!Number.isSafeInteger(priceNgn) || priceNgn <= 0) {
    return { ok: false, code: "COST_UNKNOWN", costNgn, priceNgn, marginNgn: null };
  }
  if (typeof costNgn !== "number" || !Number.isFinite(costNgn) || costNgn <= 0) {
    return { ok: false, code: "COST_UNKNOWN", costNgn: costNgn ?? null, priceNgn, marginNgn: null };
  }

  const marginNgn = priceNgn - costNgn;
  const marginRatio = marginNgn / priceNgn;
  if (marginRatio < configuredFloor()) {
    return { ok: false, code: "UNPROFITABLE", costNgn, priceNgn, marginNgn };
  }
  return { ok: true, costNgn, priceNgn, marginNgn, marginRatio };
}

/** Customer-facing wording. Never mentions cost: that is wholesale information. */
export const MARGIN_BLOCKED_MESSAGE = "That plan isn't available to buy right now.";
