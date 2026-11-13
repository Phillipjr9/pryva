/**
 * Loyalty policy only. This module is not connected to checkout or the wallet.
 * A future integration must establish a launch timestamp and verify each
 * service's fulfilment and refund states before computing an eligible count.
 */
export const LOYALTY_LEVELS = [
  { level: 1, minimumOrders: 0, discountBasisPoints: 0 },
  { level: 2, minimumOrders: 5, discountBasisPoints: 50 },
  { level: 3, minimumOrders: 15, discountBasisPoints: 100 },
  { level: 4, minimumOrders: 30, discountBasisPoints: 150 },
  { level: 5, minimumOrders: 60, discountBasisPoints: 200 },
] as const;

export type LoyaltyLevel = (typeof LOYALTY_LEVELS)[number];

/** Invalid or unknown counts are not evidence of a customer's level. */
export function loyaltyLevelForOrders(eligibleOrders: number): LoyaltyLevel | null {
  if (!Number.isSafeInteger(eligibleOrders) || eligibleOrders < 0) return null;
  return [...LOYALTY_LEVELS].reverse().find((level) => eligibleOrders >= level.minimumOrders) ?? null;
}

/**
 * A potential loyalty-only price in whole naira. The caller must supply the
 * undiscounted price and the independently verified floor for this exact order,
 * including any minimum charge. This cannot be stacked with another discount.
 * Compare the result with separately verified non-loyalty quotes at checkout.
 * A null result means the inputs could not be verified; never charge from it.
 */
export function loyaltyPriceNgn(input: {
  undiscountedNgn: number;
  minimumNgn: number;
  eligibleOrders: number;
}): number | null {
  const { undiscountedNgn, minimumNgn, eligibleOrders } = input;
  const level = loyaltyLevelForOrders(eligibleOrders);
  if (!level || !Number.isSafeInteger(undiscountedNgn) || undiscountedNgn <= 0 ||
      !Number.isSafeInteger(minimumNgn) || minimumNgn <= 0 || minimumNgn > undiscountedNgn) return null;
  // Round up to avoid granting more than the approved percentage; bigint avoids
  // floating-point rounding and intermediate overflow on valid integer inputs.
  const numerator = BigInt(undiscountedNgn) * BigInt(10_000 - level.discountBasisPoints);
  const discounted = Number((numerator + BigInt(9_999)) / BigInt(10_000));
  return Math.max(minimumNgn, discounted);
}
