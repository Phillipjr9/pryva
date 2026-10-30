/**
 * Pryva's profit policy.
 *
 * The business model: a supplier charges a **fixed amount** per unit, Pryva sells
 * it to the customer. Every selling price in the product is derived from that
 * cost, never typed in by hand, so margin cannot quietly erode when a supplier
 * raises their price or the Naira moves.
 *
 * The band is 30–50% **markup on cost**:
 *
 *     cost ₦1,000 → price ₦1,300 (30%) … ₦1,500 (50%)
 *
 * Markup on cost is what "I make 40% on this" means to a reseller: profit as a
 * share of what you paid. `grossMarginPercent()` is also exported for reporting,
 * because accountants quote margin on the *selling* price (₦1,300 − ₦1,000 is a
 * 23% gross margin but a 30% markup). Both are shown in the price audit so there
 * is no ambiguity about which number is being quoted.
 *
 * Configuration lives in env so the owner can retune without a deploy:
 *   PRICING_MIN_MARKUP_PERCENT    (default 30)
 *   PRICING_TARGET_MARKUP_PERCENT (default 40)
 *   PRICING_MAX_MARKUP_PERCENT    (default 50)
 */

import type { ServiceSlug } from "@/lib/catalog";

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const PROFIT_BAND = {
  get min() {
    return envNumber("PRICING_MIN_MARKUP_PERCENT", 30);
  },
  get target() {
    return envNumber("PRICING_TARGET_MARKUP_PERCENT", 40);
  },
  get max() {
    return envNumber("PRICING_MAX_MARKUP_PERCENT", 50);
  },
};

/**
 * Where inside the band each service sits.
 *
 * Low-ticket items sit near the top: a ₦900 number has to absorb a fixed
 * Paystack charge, a refund risk and support, so 45% is not greed, it is what
 * keeps the order worth taking. High-ticket items (gift cards, big eSIM packs)
 * sit at the bottom because customers can price-check them instantly.
 *
 * `email-otp` is absent on purpose: a temporary inbox is free, so there is no
 * cost to mark up. Its absence is not an oversight to be filled in — if this map
 * ever gains an `email-otp` entry, something has started charging for a free
 * tool. See the note on the email plans in src/lib/catalog.ts.
 */
export const SERVICE_TARGET_MARKUP: Record<string, number> = {
  numbers: 45,
  esim: 35,
  proxies: 35,
  accounts: 45,
  digital: 40,
  data: 32,
  "gift-cards": 30,
  bulk: 35,
  scheduled: 35,
  airtime: 4, // thin by nature — see the note in src/lib/airtime.ts
};

/** Rounding step for a selling price. Prices never end in an odd ₦37. */
const PRICE_STEP = 50;

/**
 * Rounding granularity, scaled to the cost.
 *
 * ₦50 steps are tidy on a ₦12,000 eSIM, but on a ₦160 listing they are wider
 * than the whole 30–50% band: 30% of ₦160 rounds to ₦200 and the next step is
 * ₦250, which is a 56% markup. Smaller steps keep cheap items inside the band.
 */
export function priceStepFor(costNgn: number): number {
  if (costNgn < 2000) return 10;
  return 50;
}

/**
 * Smallest order we will take money for.
 *
 * Paystack charges a flat ₦100 (capped at ₦2,000) plus 1.5% on a card payment.
 * A ₦120 order clears the margin band but not the fee — the fee is bigger than
 * the profit. Rather than smuggle a hidden fee into the price, we refuse the
 * order and tell the customer the minimum.
 */
export const MIN_ORDER_NGN = 500;

export type PriceQuote = {
  costNgn: number;
  priceNgn: number;
  profitNgn: number;
  /** Profit as a share of cost — the figure the band is defined on. */
  markupPercent: number;
  /** Profit as a share of the selling price — the accounting view. */
  grossMarginPercent: number;
  targetMarkupPercent: number;
};

export function markupPercent(priceNgn: number, costNgn: number): number {
  if (costNgn <= 0) return 0;
  return ((priceNgn - costNgn) / costNgn) * 100;
}

export function grossMarginPercent(priceNgn: number, costNgn: number): number {
  if (priceNgn <= 0) return 0;
  return ((priceNgn - costNgn) / priceNgn) * 100;
}

function roundUpTo(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

/** Round a Naira amount up to the nearest step (default ₦50). Exported so the
 * marketplace pipeline rounds identically to the catalogue. */
export function roundUpToNgn(value: number, step = PRICE_STEP): number {
  return roundUpTo(value, step);
}

/** The target markup for a service, always clamped inside the configured band. */
export function targetMarkupPercent(service?: string): number {
  const configured = service ? SERVICE_TARGET_MARKUP[service] : undefined;
  const wanted = configured ?? PROFIT_BAND.target;
  return Math.min(PROFIT_BAND.max, Math.max(PROFIT_BAND.min, wanted));
}

/**
 * Turn a supplier cost into a selling price inside the band.
 *
 * Rounding is always **up** to the next ₦50, so rounding can only add margin,
 * never remove it — the floor is cost × (1 + min%), and the result can only be
 * at or above that.
 */
export function priceFromCost(
  costNgn: number,
  options: { service?: string; step?: number; targetPercent?: number } = {},
): PriceQuote {
  const cost = Math.max(0, Math.round(costNgn));
  const step = options.step ?? priceStepFor(cost);
  const target = Math.min(
    PROFIT_BAND.max,
    Math.max(PROFIT_BAND.min, options.targetPercent ?? targetMarkupPercent(options.service)),
  );

  const raw = cost * (1 + target / 100);
  let price = roundUpTo(raw, step);

  // Guard rails: never below the band floor, never above the band ceiling.
  const floor = roundUpTo(cost * (1 + PROFIT_BAND.min / 100), step);
  if (price < floor) price = floor;

  const ceiling = cost * (1 + PROFIT_BAND.max / 100);
  if (price > ceiling) {
    // Rounding pushed us over 50%. Drop to the largest step that still fits,
    // then fall back to the exact ceiling rounded to the nearest naira.
    const stepped = Math.floor(ceiling / step) * step;
    price = stepped >= floor ? stepped : Math.round(ceiling);
  }

  return {
    costNgn: cost,
    priceNgn: price,
    profitNgn: price - cost,
    markupPercent: Math.round(markupPercent(price, cost) * 10) / 10,
    grossMarginPercent: Math.round(grossMarginPercent(price, cost) * 10) / 10,
    targetMarkupPercent: target,
  };
}

/** Does a price sit inside the band for its cost? Used by tests and the audit. */
export function isPriceInBand(priceNgn: number, costNgn: number): boolean {
  if (costNgn <= 0) return priceNgn > 0;
  const markup = markupPercent(priceNgn, costNgn);
  // Small tolerance for rounding to the nearest ₦50 on tiny costs.
  return markup >= PROFIT_BAND.min - 0.5 && markup <= PROFIT_BAND.max + 0.5;
}

/** Cheapest selling price that still clears the band floor. */
export function minimumProfitablePrice(costNgn: number, step?: number): number {
  return roundUpTo(
    Math.max(0, costNgn) * (1 + PROFIT_BAND.min / 100),
    step ?? priceStepFor(costNgn),
  );
}

/** The most we may charge for this cost before leaving the band. */
export function bandCeilingNgn(costNgn: number, step?: number): number {
  const cost = Math.max(0, costNgn);
  const granularity = step ?? priceStepFor(cost);
  const ceiling = Math.floor((cost * (1 + PROFIT_BAND.max / 100)) / granularity) * granularity;
  const floor = minimumProfitablePrice(cost, granularity);
  return Math.max(ceiling, floor);
}

/**
 * The lowest price we may charge this cost — the floor every discount respects.
 *
 * It is the band minimum, lifted by a flat ₦200 so that micro-listings still
 * earn something after a Paystack fee… but never lifted past the band ceiling,
 * because a ₦160 cost sold at ₦300 is an 87% markup and the owner's rule is
 * 30–50%, full stop.
 */
export function profitFloorNgn(costNgn: number, step?: number): number {
  const granularity = step ?? priceStepFor(costNgn);
  const bandFloor = minimumProfitablePrice(costNgn, granularity);
  const withFlatFee = roundUpTo(Math.max(0, costNgn) + 200, granularity);
  return Math.min(Math.max(bandFloor, withFlatFee), bandCeilingNgn(costNgn, granularity));
}

export function serviceTarget(service: ServiceSlug | string): number {
  return targetMarkupPercent(service);
}

/**
 * How far a price may be discounted before it breaks the 30% floor.
 *
 * A price at a 45% markup can lose 10.3% and still clear 30%; a price at 35% can
 * only lose 3.7%. Baskets therefore cap their discount at the tightest item's
 * headroom instead of assuming every discount is affordable.
 */
export function maxDiscountPercentFor(priceNgn: number, costNgn: number): number {
  if (priceNgn <= 0) return 0;
  const floor = Math.max(costNgn * (1 + PROFIT_BAND.min / 100), costNgn + 200);
  const headroom = (1 - floor / priceNgn) * 100;
  return Math.max(0, Math.floor(headroom));
}
