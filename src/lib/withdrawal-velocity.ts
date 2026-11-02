/**
 * How much money one account may ask to take out in a day.
 *
 * Withdrawals are instant by the owner's decision, and the floor (₦1,000) and
 * ceiling (₦5,000,000) are per request. Neither of them is a rate: an account
 * whose session has been stolen can ask for five million, five times, in one
 * minute, and every one of those is a valid single request. The reconciliation
 * screen shows pending payouts, so a human can catch it afterwards — if they
 * happen to be looking.
 *
 * This is the missing bound. It is deliberately generous: the numbers below are
 * far above what a real customer does in a day, so it is invisible to them and
 * expensive for an attacker who has to be patient.
 *
 * ## What is counted
 *
 * Requests whose money has left or is in flight: `pending`, `processing` and
 * `completed`. A `rejected` or `failed` request was returned to the wallet and is
 * not counted, because otherwise a customer who mistyped a bank account and got
 * rejected three times would be locked out of their own money for a day — the
 * control would punish the honest mistake it is easiest to make. Those paths
 * already cannot move money.
 *
 * The amount counted is the payout (`amount`), not `amount + fee`: the fee is
 * ours and is a function of the amount, so counting it would make the displayed
 * limit and the enforced one disagree by a percent.
 *
 * ## Configuration
 *
 * `WITHDRAWAL_DAILY_COUNT_LIMIT` and `WITHDRAWAL_DAILY_AMOUNT_LIMIT` (naira)
 * override the defaults. An unreadable value falls back to the default rather
 * than to "unlimited": a typo in a deployment variable must not be the thing that
 * removes the control.
 */

export const VELOCITY_WINDOW_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_DAILY_COUNT = 3;
export const DEFAULT_DAILY_AMOUNT = 1_000_000;

export type VelocityLimits = { maxCount: number; maxAmountNgn: number };

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw?.trim());
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function velocityLimits(): VelocityLimits {
  return {
    maxCount: positiveInt(process.env.WITHDRAWAL_DAILY_COUNT_LIMIT, DEFAULT_DAILY_COUNT),
    maxAmountNgn: positiveInt(process.env.WITHDRAWAL_DAILY_AMOUNT_LIMIT, DEFAULT_DAILY_AMOUNT),
  };
}

export type WithdrawalForVelocity = {
  amount: number;
  status: string;
  createdAt: Date;
};

export type VelocityAllowed = {
  allowed: true;
  usedCount: number;
  usedAmount: number;
  remainingCount: number;
  remainingAmount: number;
};

export type VelocityRefused = {
  allowed: false;
  reason: "count" | "amount";
  usedCount: number;
  usedAmount: number;
  /** When the oldest counted request ages out of the window. */
  retryAt: Date | null;
  message: string;
};

export type VelocityVerdict = VelocityAllowed | VelocityRefused;

/** Money that left the wallet, or is about to. Returned funds are not counted. */
const COUNTS_TOWARD_LIMIT = new Set(["pending", "processing", "completed"]);

function lagosTime(at: Date): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Lagos",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(at);
  } catch {
    return at.toISOString();
  }
}

export function naira(value: number): string {
  return `₦${Math.round(value).toLocaleString("en-NG")}`;
}

/**
 * Decide whether one more request fits, given the account's recent requests.
 *
 * Pure: the caller supplies the rows and the clock, so the boundary behaviour
 * (exactly 24 hours, exactly on the cap) is testable without a database.
 */
export function assessVelocity(
  recent: WithdrawalForVelocity[],
  requestedAmount: number,
  limits: VelocityLimits,
  now: Date,
): VelocityVerdict {
  const since = now.getTime() - VELOCITY_WINDOW_MS;
  const counted = recent.filter(
    (row) => COUNTS_TOWARD_LIMIT.has(row.status) && row.createdAt.getTime() > since,
  );

  const usedCount = counted.length;
  const usedAmount = counted.reduce((sum, row) => sum + row.amount, 0);

  // The earliest counted request is the first to age out, so it is the answer to
  // "when can I try again" for both kinds of breach.
  const oldest = counted.reduce<WithdrawalForVelocity | null>(
    (earliest, row) => (!earliest || row.createdAt.getTime() < earliest.createdAt.getTime() ? row : earliest),
    null,
  );
  const retryAt = oldest ? new Date(oldest.createdAt.getTime() + VELOCITY_WINDOW_MS) : null;

  if (usedCount + 1 > limits.maxCount) {
    return {
      allowed: false,
      reason: "count",
      usedCount,
      usedAmount,
      retryAt,
      message:
        `You can make ${limits.maxCount} withdrawal ${limits.maxCount === 1 ? "request" : "requests"} in 24 hours, and you have used ${usedCount}. ` +
        (retryAt ? `The next one can be requested after ${lagosTime(retryAt)} (Lagos time).` : "Please try again later."),
    };
  }

  if (usedAmount + requestedAmount > limits.maxAmountNgn) {
    const room = Math.max(limits.maxAmountNgn - usedAmount, 0);
    return {
      allowed: false,
      reason: "amount",
      usedCount,
      usedAmount,
      retryAt,
      message:
        `You can withdraw up to ${naira(limits.maxAmountNgn)} in 24 hours, and ${naira(usedAmount)} of that is already requested. ` +
        (room > 0
          ? `You can request up to ${naira(room)} more right now.`
          : retryAt
            ? `The next request can be made after ${lagosTime(retryAt)} (Lagos time).`
            : "Please try again later."),
    };
  }

  return {
    allowed: true,
    usedCount,
    usedAmount,
    remainingCount: limits.maxCount - usedCount - 1,
    remainingAmount: Math.max(limits.maxAmountNgn - usedAmount - requestedAmount, 0),
  };
}
