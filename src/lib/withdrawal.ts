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

/**
 * Card-funded balances are held before they can leave the platform.
 *
 * The exposure is chargeback fraud: top up with a stolen card, withdraw to your
 * own bank account immediately, and the chargeback lands weeks later on money
 * that has already gone. A hold does not stop a legitimate customer, it only
 * delays them -- but it closes the window a fraudster needs.
 *
 * 48 hours by default. Configurable in hours because the right value depends on
 * how long the payment provider leaves a charge disputeable, which is not
 * something a code change should be needed to tune.
 */
const DEFAULT_WITHDRAWAL_HOLD_MS = 48 * 60 * 60 * 1000;

export function withdrawalHoldMs(): number {
  const raw = process.env.WITHDRAWAL_HOLD_HOURS?.trim();
  if (!raw) return DEFAULT_WITHDRAWAL_HOLD_MS;
  const hours = Number(raw);
  // An unparsable, negative or absurd value must never shorten the hold to zero:
  // a typo in the environment should not silently disable a fraud control.
  if (!Number.isFinite(hours) || hours < 0 || hours > 24 * 30) return DEFAULT_WITHDRAWAL_HOLD_MS;
  return Math.round(hours * 60 * 60 * 1000);
}

/**
 * Milliseconds still held for a balance funded at `paidAt`; 0 once it clears.
 *
 * A null timestamp means there is no card top-up to hold against, which is the
 * normal case for gift-card or transfer funding. An *unparsable* timestamp is
 * different: the funding exists but its age cannot be established, so this fails
 * closed and holds for the full window rather than letting an unknown-age
 * balance leave.
 */
export function holdRemainingMs(paidAt: Date | string | null | undefined, now = Date.now()): number {
  if (paidAt === null || paidAt === undefined) return 0;
  const at = typeof paidAt === "string" ? new Date(paidAt).getTime() : paidAt.getTime();
  if (!Number.isFinite(at)) return withdrawalHoldMs();
  return Math.max(0, at + withdrawalHoldMs() - now);
}
