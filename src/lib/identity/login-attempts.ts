import "server-only";

import { after } from "next/server";

import { hashSignal, recordFraudEvent } from "@/lib/admin/fraud";
import { LOCKOUT_DURATION_MS, LOCKOUT_THRESHOLD } from "@/lib/identity/account-lockout";
import { clientIp } from "@/lib/identity/auth-rate-limit";
import { sendAlert } from "@/lib/platform/alerts";
import { logger } from "@/lib/platform/logger";
import {
  FAILED_SIGN_IN_ALERT_THRESHOLD,
  FAILED_SIGN_IN_ALERT_WINDOW_MS,
  SECOND_FACTOR_FAILURE_ALERT_THRESHOLD,
  failedSignInTally,
  secondFactorFailureTally,
  type RateLimitResult,
} from "@/lib/platform/rate-limit";

/**
 * "Log every failed attempt so you can see the attack."
 *
 * Sign-in already refused a guessing run — per-IP and per-address limits, a
 * lockout after eight wrong passwords, five tries per two-factor challenge —
 * and it did all of that in silence. A wrong password wrote nothing. A throttled
 * request wrote nothing. An account being locked wrote nothing. Ten thousand
 * guesses in a minute left no line an operator could read and rang no bell, so
 * the first anybody heard of an attack was a customer asking why they could not
 * sign in.
 *
 * This is the missing half. Three things happen for every failed sign-in:
 *
 *   1. **One log line**, always, before the response is sent. It carries why the
 *      attempt failed, the account if the address has one, and salted hashes of
 *      the address tried and the network it came from — the same hash the fraud
 *      tables store, so a line here can be matched to a row there. Never the
 *      password, never the raw address, never the raw IP.
 *   2. **A count**, after the response, in the shared rate-limit store. When an
 *      hour's failures across the whole site reach the threshold, the operator
 *      is told once: a row in the queue at `/admin/security`, an email to the
 *      fraud-alert recipients, and a line on `ALERT_WEBHOOK_URL`.
 *   3. **A queue entry for the account**, when this attempt is the one that
 *      locked it, or when wrong two-factor codes keep arriving after a correct
 *      password. The second is the loudest signal sign-in can produce: whoever
 *      is typing those codes already has the password.
 *
 * What is mailed, and why not everything: an account can be locked by anybody
 * who knows its address, so a lockout is queued and not mailed — an inbox that an
 * attacker can fill is an inbox nobody reads, and each of those messages would
 * come out of the same quota as a customer's password reset. The site-wide alert
 * is at most one an hour. The two-factor alert needs a correct password first.
 *
 * Nothing here blocks anything. The limits that refuse a request stay where they
 * were; this only makes what they refused visible. And nothing here can change
 * the answer the visitor gets: every step is best effort, the counting runs
 * after the response, and a failure to log, count or alert is itself only logged.
 *
 * Nor does it turn an attack into database load. The count is one small write
 * per failure, but only until the hour's alert has gone out: after that the
 * number has nothing left to say, so an instance that has seen the threshold
 * passed stops writing until the window ends (`bump`, below). Ten thousand
 * guesses cost ten thousand log lines and about a hundred writes, not ten
 * thousand writes queued on one row.
 */

export type FailedSignInReason =
  /** The address has an account; the password was wrong. */
  | "wrong_password"
  /** Nobody has that address. */
  | "unknown_account"
  /** The account was closed or suspended. */
  | "closed_account"
  /** The account is locked; the password was not looked at. */
  | "account_locked"
  /** A rate limit refused the request before anything was checked. */
  | "throttled"
  /** The password was right and the two-factor code was not. */
  | "wrong_second_factor";

export type FailedSignIn = {
  reason: FailedSignInReason;
  /** The account, when the attempt can be tied to one. */
  userId?: string | null;
  /** The address that was tried. Hashed before it is written anywhere. */
  email?: string | null;
  /** True for the attempt that set the lock, not for ones refused by it. */
  lockedNow?: boolean;
};

/** One bucket for the whole site: the question is "how many", not "from where". */
const SITE_TALLY_KEY = "signin:failures";

const WINDOW_LABEL = `${Math.round(FAILED_SIGN_IN_ALERT_WINDOW_MS / 60_000)}m`;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}

/**
 * True for exactly one caller per window: the one whose bump landed on the
 * maximum. Before it there is room left; after it the bucket reports "over".
 * The store counts atomically across instances, so this is once per window for
 * the whole deployment rather than once per server.
 */
export function reachedThreshold(result: RateLimitResult): boolean {
  return !result.unavailable && result.allowed && result.remaining === 0;
}

/**
 * Tallies this instance already knows are at or past their threshold, and when
 * each window ends.
 *
 * Every bump is a write to one row, and for the site-wide tally it is the same
 * row for every failed sign-in on every instance. That is nothing at the rate
 * people mistype passwords. During the attack this exists to report, it would be
 * the busiest row in the database, written by work that runs after the response
 * and holds a pooled connection while it waits its turn. Once the threshold is
 * passed the alert is already out and the bucket stops counting anyway, so the
 * only thing more writes would add is load.
 *
 * Per instance on purpose: it is an optimisation, not the source of truth. A
 * fresh instance writes until the store tells it the window is spent, which
 * costs one write each, and the "exactly once" of the alert still comes from the
 * shared bucket. Window ends are the database's clock read against this
 * server's; a few seconds of skew moves a handful of counts to the wrong side of
 * a window boundary and changes nothing else.
 */
const spentUntil = new Map<string, number>();
const MAX_SPENT_KEYS = 500;

function rememberSpent(key: string, resetTime: number): void {
  if (!spentUntil.has(key) && spentUntil.size >= MAX_SPENT_KEYS) {
    const now = Date.now();
    for (const [known, until] of spentUntil) if (now >= until) spentUntil.delete(known);
    // Still full of live windows: drop the oldest. It costs that key one write.
    if (spentUntil.size >= MAX_SPENT_KEYS) {
      const oldest = spentUntil.keys().next().value;
      if (oldest !== undefined) spentUntil.delete(oldest);
    }
  }
  spentUntil.set(key, resetTime);
}

/** Forget what this instance has learned about spent windows. For tests. */
export function resetSignInTallies(): void {
  spentUntil.clear();
}

/**
 * Add one to a tally. True when this bump is the one that reached the
 * threshold; false before it, after it, and when the store could not say.
 */
async function bump(tally: (key: string) => Promise<RateLimitResult>, key: string): Promise<boolean> {
  const until = spentUntil.get(key);
  if (until !== undefined) {
    if (Date.now() < until) return false;
    spentUntil.delete(key);
  }

  const result = await tally(key);
  // A failed store reports "nothing left" too; that is not a count to remember.
  if (!result.unavailable && result.remaining === 0) rememberSpent(key, result.resetTime);
  return reachedThreshold(result);
}

/**
 * Record one failed sign-in. Synchronous and silent on failure: call it on the
 * way out of a route, immediately before returning the refusal.
 */
export function noteFailedSignIn(request: Request, attempt: FailedSignIn): void {
  try {
    const network = hashSignal(clientIp(request));
    const address = hashSignal(attempt.email);

    logger.warn("Sign-in failed", {
      reason: attempt.reason,
      ...(attempt.userId ? { userId: attempt.userId } : {}),
      ...(address ? { address } : {}),
      ...(network ? { network } : {}),
      ...(attempt.lockedNow ? { locked: true } : {}),
    });

    const followUp = () => countFailedSignIn(attempt, network);
    try {
      // After the response: a refusal must not wait on a counter, and a slow
      // database must not make a wrong password slower than a right one.
      after(followUp);
    } catch {
      // No request scope (a script, a directly invoked handler). The count still
      // matters, so run it detached; it never rejects.
      void followUp();
    }
  } catch (error) {
    console.error("[auth] could not record a failed sign-in attempt:", describe(error));
  }
}

/**
 * The part that touches the database: queue the account-level signals and bump
 * the tallies. Exported for tests; routes go through `noteFailedSignIn`.
 *
 * Each step stands alone, so one failing does not skip the others. Never rejects.
 */
export async function countFailedSignIn(attempt: FailedSignIn, network: string | null = null): Promise<void> {
  if (attempt.lockedNow && attempt.userId) {
    try {
      await recordFraudEvent({
        userId: attempt.userId,
        kind: "login_lockout",
        // Queued, not mailed: see the note on mail at the top of this file.
        severity: "warn",
        reasons: [
          `${LOCKOUT_THRESHOLD} wrong passwords in a row for this account`,
          `Sign-in is locked for ${Math.round(LOCKOUT_DURATION_MS / 60_000)} minutes, or until a password reset is completed`,
        ],
        ipHash: network,
      });
    } catch (error) {
      logger.warn("Could not queue the sign-in lockout", { error: describe(error) });
    }
  }

  if (attempt.reason === "wrong_second_factor" && attempt.userId) {
    try {
      if (await bump(secondFactorFailureTally, `signin:second-factor-failures:${attempt.userId}`)) {
        await recordFraudEvent({
          userId: attempt.userId,
          kind: "second_factor_guessing",
          severity: "high",
          reasons: [
            `${SECOND_FACTOR_FAILURE_ALERT_THRESHOLD} wrong two-factor codes within an hour, each one after a correct password`,
            "Whoever is entering them already knows this account's password",
          ],
          ipHash: network,
        });
      }
    } catch (error) {
      logger.warn("Could not count the failed two-factor code", { error: describe(error) });
    }
  }

  try {
    if (!(await bump(failedSignInTally, SITE_TALLY_KEY))) return;

    // A count, a window and a threshold. Which accounts and which networks is in
    // the log lines above and in the queue, where an operator can act on it.
    await recordFraudEvent({
      kind: "login_failure_spike",
      severity: "high",
      reasons: [
        `${FAILED_SIGN_IN_ALERT_THRESHOLD} failed sign-in attempts within an hour, across all accounts`,
        'The rate limits and the account lockout are already refusing them. Search the logs for "Sign-in failed" to see the accounts and networks involved',
      ],
    });
    await sendAlert("Sign-in attack: failed sign-in attempts in the last hour reached the alert threshold", {
      window: WINDOW_LABEL,
      threshold: FAILED_SIGN_IN_ALERT_THRESHOLD,
    });
    logger.warn("Failed sign-in spike alert raised", { window: WINDOW_LABEL, threshold: FAILED_SIGN_IN_ALERT_THRESHOLD });
  } catch (error) {
    logger.warn("Could not count the failed sign-in", { error: describe(error) });
  }
}
