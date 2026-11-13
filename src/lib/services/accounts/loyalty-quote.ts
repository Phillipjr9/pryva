import "server-only";

import { usdCents, usdMicros } from "@/lib/payments/supplier-money";
import { loyaltyLevelForOrders, loyaltyPriceNgn } from "@/lib/services/loyalty-policy";
import { MIN_ORDER_NGN, profitFloorNgn } from "@/lib/services/pricing";
import type { PriceBreakdown } from "@/lib/services/accounts/marketplace-pricing";

/**
 * PREPARATION ONLY: not connected to checkout. Input must come from a fresh
 * server-side price and, if present, a supplier-validated promo. Never accept
 * this structure or a loyalty count from the browser. The caller will still
 * need consent, revalidation, durable audit and idempotent charging.
 */
export function compareAccountDiscounts(input: {
  price: PriceBreakdown;
  eligibleOrders: number;
  validatedPromoDiscountUsd?: string;
}) {
  const { price, eligibleOrders, validatedPromoDiscountUsd } = input;
  const level = loyaltyLevelForOrders(eligibleOrders);
  const base = price.undiscountedTotalNgn;
  const volume = price.totalNgn;
  const safeMoney = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= 2_147_483_647;
  if (!level || price.hasProviderPromo !== false || !safeMoney(base) || !safeMoney(volume) || volume > base ||
      !Number.isFinite(price.exactCostNgn) || price.exactCostNgn <= 0 ||
      !Number.isFinite(price.exactFxRate) || price.exactFxRate <= 0) {
    throw new Error("Unverifiable account quote");
  }

  // Do not turn a basket that checkout would reject into a payable order.
  // The minimum is not a surcharge and must not raise a subminimum basket.
  const normalFloor = Math.max(MIN_ORDER_NGN, profitFloorNgn(price.exactCostNgn));
  if (!safeMoney(normalFloor) || base < normalFloor || volume < normalFloor) {
    throw new Error("Account quote below minimum or margin floor");
  }
  const loyalty = loyaltyPriceNgn({ undiscountedNgn: base, minimumNgn: normalFloor, eligibleOrders });
  if (loyalty === null) throw new Error("Unverifiable loyalty quote");

  let promo: number | null = null;
  let promoFloor: number | null = null;
  if (validatedPromoDiscountUsd !== undefined) {
    const raw = validatedPromoDiscountUsd.trim();
    if (!/^\d{1,9}(?:\.\d+)?$/.test(raw)) throw new Error("Invalid promo discount");
    usdMicros(raw); // enforce the supplier-money range even for tiny fractions
    // Truncate before parsing: usdMicros rounds digits beyond six up, which
    // could otherwise turn a value just below a cent into a whole cent.
    const [whole, fraction = ""] = raw.split(".");
    const truncated = `${whole}.${fraction.slice(0, 2).padEnd(2, "0")}`;
    // Round the supplier discount down twice; the cost basis can only be
    // overstated. An oversized promo cannot reduce the supplier cost below 0.
    const reductionNgn = Math.floor(usdCents(truncated, "down") * price.exactFxRate / 100);
    if (!Number.isSafeInteger(reductionNgn) || reductionNgn < 0) throw new Error("Invalid promo discount");
    const adjustedCost = Math.max(0, price.exactCostNgn - reductionNgn);
    promoFloor = Math.max(MIN_ORDER_NGN, profitFloorNgn(adjustedCost));
    // Promo is calculated against the undiscounted basket, never the volume or
    // loyalty price. Its own reduced supplier cost determines its own floor.
    promo = Math.max(base - reductionNgn, promoFloor);
    if (!safeMoney(promoFloor) || !safeMoney(promo)) throw new Error("Unverifiable promo quote");
  }

  // On ties prefer no provider promo, avoiding unnecessary supplier coupling.
  let winner: "none" | "volume" | "loyalty" | "promo" = "none";
  let totalNgn = base;
  if (volume < totalNgn) { winner = "volume"; totalNgn = volume; }
  if (loyalty < totalNgn) { winner = "loyalty"; totalNgn = loyalty; }
  if (promo !== null && promo < totalNgn) { winner = "promo"; totalNgn = promo; }

  return {
    winner, totalNgn, undiscountedNgn: base, savedNgn: base - totalNgn,
    eligibleOrders, loyaltyLevel: level.level, loyaltyBasisPoints: level.discountBasisPoints,
    candidates: { volumeNgn: volume, loyaltyNgn: loyalty, promoNgn: promo },
    floors: { normalNgn: normalFloor, promoNgn: promoFloor },
    /** Only a winning promo may be submitted to the supplier. */
    submitPromo: winner === "promo",
  };
}
