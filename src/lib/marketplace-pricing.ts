/**
 * Marketplace pricing: supplier USD cost → Naira selling price.
 *
 * The problem: buying at $1 and selling at $1 earns nothing. Every price goes
 * through four stacked steps and then a hard margin floor, so no order — with or
 * without a volume discount or a promo code — can be sold outside the profit
 * band in `src/lib/pricing.ts` (30–50% markup on cost):
 *
 *   1. Base markup            (the service target, default 40%)
 *   2. Category premium       (popular categories sit higher *inside* the band)
 *   3. Volume discount        (rewards bigger baskets, never below the floor)
 *   4. Profit floor           (cost × 1.30, re-applied after every discount)
 *
 * All arithmetic is integer-cents until the final Naira rounding, so we never
 * accumulate float error on money.
 */

import { getUsdToNgnRate } from "@/lib/exchange-rate";
import { usdCents } from "@/lib/supplier-money";
import {
  PROFIT_BAND,
  bandCeilingNgn,
  markupPercent,
  MIN_ORDER_NGN,
  priceStepFor,
  profitFloorNgn,
  roundUpToNgn,
} from "@/lib/pricing";

/** Target markup before category premium. Clamped inside the band at use. */
const BASE_MARKUP_PERCENT = Number(
  process.env.MARKETPLACE_BASE_MARKUP_PERCENT || PROFIT_BAND.target,
);
const MIN_PROFIT_NGN = Number(process.env.MARKETPLACE_MIN_PROFIT_NGN || 200);
const PRICE_ROUNDING_NGN = 50; // displayed in pricingConfig(); actual step scales with cost

/**
 * Category premiums lift a category toward the top of the band rather than past
 * it: a Facebook account is price-checked less than a gift card, so it sits at
 * ~48% instead of 40%, never at 55%.
 */
const CATEGORY_PREMIUMS: Array<{ match: string[]; percent: number }> = [
  { match: ["facebook"], percent: 8 },
  { match: ["instagram"], percent: 8 },
  { match: ["twitter", " x ", "tiktok"], percent: 5 },
  { match: ["gmail", "outlook", "hotmail", "email"], percent: 3 },
];

/** Basket discounts, applied to the subtotal. The floor eats into these. */
const VOLUME_TIERS: Array<{ minQuantity: number; percent: number }> = [
  { minQuantity: 25, percent: 10 },
  { minQuantity: 10, percent: 8 },
  { minQuantity: 5, percent: 5 },
];

export type PriceBreakdown = {
  /** Naira per unit, after markup, before any volume discount. */
  unitNgn: number;
  /** Naira total actually charged. */
  totalNgn: number;
  quantity: number;
  discountPercent: number;
  discountNgn: number;
  costNgn: number;
  profitNgn: number;
  /** Realised markup on cost, after every discount. Always ≥ PROFIT_BAND.min. */
  markupPercent: number;
  fxRate: number;
  fxSource: string;
};

function categoryPremiumPercent(
  categoryTitle: string | undefined,
  subcategoryTitle: string | undefined,
): number {
  const haystack = ` ${(categoryTitle ?? "").toLowerCase()} ${(subcategoryTitle ?? "").toLowerCase()} `;
  for (const entry of CATEGORY_PREMIUMS) {
    if (entry.match.some((needle) => haystack.includes(needle))) return entry.percent;
  }
  return 0;
}

function volumeDiscountPercent(quantity: number): number {
  for (const tier of VOLUME_TIERS) {
    if (quantity >= tier.minQuantity) return tier.percent;
  }
  return 0;
}

function clampToBand(percent: number): number {
  return Math.min(PROFIT_BAND.max, Math.max(PROFIT_BAND.min, percent));
}

/**
 * Price one basket.
 *
 * @param unitPriceUsd listing price as a canonical six-decimal string ("3.480000")
 * @param quantity      units being bought (>= 1)
 * @param categoryTitle used for the category premium
 */
export async function priceMarketplaceListing(input: {
  unitPriceUsd: string;
  quantity: number;
  categoryTitle?: string;
  subcategoryTitle?: string;
}): Promise<PriceBreakdown> {
  const quantity = Math.max(1, Math.floor(input.quantity));
  const { rate, source } = await getUsdToNgnRate();

  const unitUsdCents = usdCents(input.unitPriceUsd);
  const costCents = unitUsdCents * quantity;

  const intendedMarkup = clampToBand(
    BASE_MARKUP_PERCENT + categoryPremiumPercent(input.categoryTitle, input.subcategoryTitle),
  );
  const discountPercent = volumeDiscountPercent(quantity);

  // Cost in Naira, kept in cents until the end.
  const costNgnCents = costCents * rate;
  const markedUpCents = costNgnCents * (1 + intendedMarkup / 100);
  const discountedCents = markedUpCents * (1 - discountPercent / 100);

  // Floor and ceiling both come from the band: after a volume discount the price
  // may not fall under 30% markup, and rounding may not push it past 50%.
  const costNgnExact = costNgnCents / 100;
  const step = priceStepFor(costNgnExact);
  const ceilingNgn = bandCeilingNgn(costNgnExact, step);
  // MIN_PROFIT_NGN lifts the floor, but only as far as the band allows.
  const floorNgn = Math.min(
    Math.max(profitFloorNgn(costNgnExact, step), costNgnExact + MIN_PROFIT_NGN),
    ceilingNgn,
  );

  const chargeableCents = Math.max(discountedCents, floorNgn * 100);
  const totalNgn = Math.min(
    Math.max(roundUpToNgn(chargeableCents / 100, step), floorNgn),
    ceilingNgn,
  );

  const unitNgn = Math.ceil(totalNgn / quantity);
  const costNgn = Math.round(costNgnCents / 100);
  const discountNgn = Math.max(0, Math.round((markedUpCents - chargeableCents) / 100));

  return {
    unitNgn,
    totalNgn,
    quantity,
    discountPercent,
    discountNgn,
    costNgn,
    profitNgn: totalNgn - costNgn,
    markupPercent: Math.round(markupPercent(totalNgn, costNgn) * 10) / 10,
    fxRate: Math.round(rate * 100) / 100,
    fxSource: source,
  };
}

/**
 * Pass a provider promo discount through to the customer.
 *
 * The discount lands on the upstream (USD) side, so our cost drops by the same
 * amount. We forward the reduction in Naira but re-apply the margin floor on the
 * reduced cost — a promo can shrink our profit, never breach the 30% floor.
 *
 * @param discountUsd the `discount` string from the promo validation call
 */
export function applyPromoDiscount(breakdown: PriceBreakdown, discountUsd: string): PriceBreakdown {
  const requestedNgn = Math.round((usdCents(discountUsd, "down") * breakdown.fxRate) / 100);
  if (!Number.isFinite(requestedNgn) || requestedNgn <= 0) return breakdown;

  const newCostNgn = Math.max(0, breakdown.costNgn - requestedNgn);
  const step = priceStepFor(newCostNgn);
  const floorNgn = Math.min(
    Math.max(profitFloorNgn(newCostNgn, step), newCostNgn + MIN_PROFIT_NGN),
    bandCeilingNgn(newCostNgn, step),
  );

  // A huge promo can zero out the upstream cost. We still never take an order
  // below the minimum chargeable amount — a ₦0 basket is not a sale.
  const minimumCharge = Math.min(breakdown.totalNgn, MIN_ORDER_NGN);
  const desired = roundUpToNgn(breakdown.totalNgn - requestedNgn, PRICE_ROUNDING_NGN);
  const totalNgn = Math.max(desired, floorNgn, minimumCharge);
  const applied = Math.max(0, breakdown.totalNgn - totalNgn);

  return {
    ...breakdown,
    totalNgn,
    unitNgn: Math.ceil(totalNgn / breakdown.quantity),
    costNgn: newCostNgn,
    profitNgn: totalNgn - newCostNgn,
    discountNgn: breakdown.discountNgn + applied,
    markupPercent: Math.round(markupPercent(totalNgn, newCostNgn) * 10) / 10,
  };
}

/** Display-only unit price for catalogue cards (quantity 1). */
export async function displayUnitPriceNgn(input: {
  unitPriceUsd: string;
  categoryTitle?: string;
  subcategoryTitle?: string;
}): Promise<number> {
  const breakdown = await priceMarketplaceListing({ ...input, quantity: 1 });
  return breakdown.unitNgn;
}

export function pricingConfig() {
  return {
    baseMarkupPercent: BASE_MARKUP_PERCENT,
    minProfitNgn: MIN_PROFIT_NGN,
    roundingNgn: PRICE_ROUNDING_NGN,
    adaptiveStep: true,
    band: { min: PROFIT_BAND.min, target: PROFIT_BAND.target, max: PROFIT_BAND.max },
    categoryPremiums: CATEGORY_PREMIUMS,
    volumeTiers: VOLUME_TIERS,
  };
}
