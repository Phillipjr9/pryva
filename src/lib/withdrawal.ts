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

// Withdrawals are instant, by the owner's decision.
//
// An earlier version held card-funded balances for 48 hours against chargeback
// fraud: top up with a stolen card, withdraw to your own bank account, and the
// dispute lands weeks later on money that has already gone. A hold never stops a
// legitimate customer, it only delays them -- but it closes the window a
// fraudster needs. The owner has accepted that exposure in exchange for payouts
// that leave immediately, so the delay is removed rather than set to zero.
//
// If this is ever revisited, the control belongs here and keys on the newest
// completed card top-up's paidAt. Setting a knob to 0 would have left dead code
// that reads like a live control; deleting it keeps the file honest about what
// the platform actually does.
