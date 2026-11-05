/** Largest amount the orders and wallet ledger integer columns can hold. */
export const MAX_BOOST_AMOUNT_NGN = 2_147_483_647;
export const MAX_BOOST_QUANTITY = 100_000_000;

/**
 * Calculate the displayed and charged amount identically in whole naira.
 * Bound the integer product before multiplying, so it stays exact even for a
 * large quantity. Zero means the input or resulting amount cannot be purchased.
 */
export function totalForQuantity(perThousand: number, quantity: number): number {
  if (!Number.isSafeInteger(perThousand) || perThousand <= 0 ||
      !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > MAX_BOOST_QUANTITY) return 0;
  const maxProduct = MAX_BOOST_AMOUNT_NGN * 1_000;
  if (perThousand > Math.floor(maxProduct / quantity)) return 0;
  return Math.ceil((perThousand * quantity) / 1_000);
}
