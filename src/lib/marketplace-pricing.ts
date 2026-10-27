/**
 * Marketplace pricing: USD cost → Naira selling price.
 *
 * The problem: buying at $1 and selling at $1 earns nothing. Every price goes
 * through four stacked steps, and the result is floored so no order can ever be
 * sold at a loss:
 *
 *   1. Base markup            (covers FX drift, Paystack fees, support, margin)
 *   2. Category premium       (popular categories carry a little more)
 *   3. Volume discount        (rewards bigger baskets, never below the floor)
 *   4. Minimum profit floor   (cheap listings still clear a fixed Naira profit)
 *
 * All arithmetic is integer-cents until the final Naira rounding, so we never
 * accumulate float error on money.
 */

import { getUsdToNgnRate } from "@/lib/exchange-rate";
import { usdCents } from "@/lib/accszone";

const BASE_MARKUP_PERCENT = Number(process.env.MARKETPLACE_BASE_MARKUP_PERCENT || 30);
const MIN_PROFIT_NGN = Number(process.env.MARKETPLACE_MIN_PROFIT_NGN || 200);
const PRICE_ROUNDING_NGN = 50;

/** Extra margin on categories that sell themselves. Keyed by lowercase substring. */
const CATEGORY_PREMIUMS: Array<{ match: string[]; percent: number }> = [
  { match: ["facebook"], percent: 15 },
  { match: ["instagram"], percent: 15 },
  { match: ["twitter", " x ", "tiktok"], percent: 10 },
  { match: ["gmail", "outlook", "hotmail", "email"], percent: 5 },
];

/** Basket discounts, applied to the subtotal. */
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
  fxRate: number;
  fxSource: string;
  markupPercent: number;
};

function categoryPremiumPercent(categoryTitle: string | undefined, subcategoryTitle: string | undefined): number {
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

function roundUpTo(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

/**
 * Price one basket.
 *
 * @param unitPriceUsd listing price as the provider sends it ("0.44")
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

  const premium = categoryPremiumPercent(input.categoryTitle, input.subcategoryTitle);
  const markupPercent = BASE_MARKUP_PERCENT + premium;
  const discountPercent = volumeDiscountPercent(quantity);

  // Cost in Naira, kept in cents until the end.
  const costNgnCents = (costCents * rate);
  const markedUpCents = costNgnCents * (1 + markupPercent / 100);
  const discountedCents = markedUpCents * (1 - discountPercent / 100);

  // Floor: cost + minimum profit, evaluated after the discount so a big basket
  // still can't dip under the floor.
  const floorCents = costNgnCents + MIN_PROFIT_NGN * 100;
  const chargeableCents = Math.max(discountedCents, floorCents);

  const totalNgn = Math.max(
    roundUpTo(chargeableCents / 100, PRICE_ROUNDING_NGN),
    roundUpTo(floorCents / 100, PRICE_ROUNDING_NGN),
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
    fxRate: Math.round(rate * 100) / 100,
    fxSource: source,
    markupPercent,
  };
}

/**
 * Pass a provider promo discount through to the customer.
 *
 * The discount lands on the upstream (USD) side, so our cost drops by the same
 * amount. We forward the whole reduction in Naira and re-apply the profit floor
 * on the reduced cost, which keeps the order profitable no matter how large the
 * code is.
 *
 * @param discountUsd the `discount` string from the promo validation call
 */
export function applyPromoDiscount(breakdown: PriceBreakdown, discountUsd: string): PriceBreakdown {
  const discountNgn = Math.round((usdCents(discountUsd) * breakdown.fxRate) / 100);
  if (!Number.isFinite(discountNgn) || discountNgn <= 0) return breakdown;

  const newCostNgn = Math.max(0, breakdown.costNgn - discountNgn);
  const floorNgn = roundUpTo(newCostNgn + MIN_PROFIT_NGN, PRICE_ROUNDING_NGN);
  const totalNgn = Math.max(roundUpTo(breakdown.totalNgn - discountNgn, PRICE_ROUNDING_NGN), floorNgn);

  const applied = Math.max(0, breakdown.totalNgn - totalNgn);

  return {
    ...breakdown,
    totalNgn,
    unitNgn: Math.ceil(totalNgn / breakdown.quantity),
    costNgn: newCostNgn,
    profitNgn: totalNgn - newCostNgn,
    discountNgn: breakdown.discountNgn + applied,
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
    categoryPremiums: CATEGORY_PREMIUMS,
    volumeTiers: VOLUME_TIERS,
  };
}
