export const MIN_WITHDRAWAL = 1_000;
export const MAX_WITHDRAWAL = 5_000_000;

/** The recipient receives `amount`; the wallet pays this fee in addition. */
export function withdrawalFee(amount: number): number {
  return amount > 5_000 ? Math.floor(amount / 100) : 0;
}

/** Largest whole-naira payout that fits the balance after the additional fee. */
export function maxWithdrawalForBalance(balance: number): number {
  if (!Number.isSafeInteger(balance) || balance <= 0) return 0;
  let low = 0;
  let high = Math.min(balance, MAX_WITHDRAWAL);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (middle + withdrawalFee(middle) <= balance) low = middle;
    else high = middle - 1;
  }
  return low;
}
