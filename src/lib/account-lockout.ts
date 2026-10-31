import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

/**
 * Per-account lockout after repeated wrong passwords.
 *
 * ## Why, when sign-in is already rate limited
 *
 * `auth-rate-limit` counts requests in fixed windows, keyed by IP and by email.
 * That stops a burst. It does not stop the patient attack: five attempts, wait
 * fifteen minutes, five more — a small botnet or one slow script can grind a
 * single password for days while staying under every window. The lockout is the
 * counter that survives the window, and unlike the preview limiter it is stored
 * on the account, so it holds across deploys and app instances.
 *
 * ## The numbers, and why they are these numbers
 *
 *   * **8 failures** — high enough that someone mistyping a password they just
 *     changed is not locked out in the first bad minute, low enough that online
 *     guessing is hopeless: about 16 guesses an hour against one account
 *     instead of as many as the network allows.
 *   * **30 minutes** — long enough to make an online campaign pointless, short
 *     enough that a locked customer can wait it out rather than file a support
 *     ticket. The wait is shown to them, and completing a password reset
 *     releases the lock immediately: proving control of the mailbox is a
 *     stronger signal than a forgotten password.
 *
 * Both are exported so a test can prove them and an operator can quote them.
 */
export const LOCKOUT_THRESHOLD = 8;
export const LOCKOUT_DURATION_MS = 30 * 60 * 1000;

/** The shape the sign-in path needs; a full user row satisfies it. */
export type LockableUser = {
  id: string;
  failedLoginAttempts?: number | null;
  lockedUntil?: Date | string | null;
};

/** Milliseconds until the lock lifts. `0` when the account is not locked. */
export function lockoutRemainingMs(user: LockableUser, now: number = Date.now()): number {
  if (!user.lockedUntil) return 0;
  const until = new Date(user.lockedUntil).getTime();
  if (!Number.isFinite(until) || until <= now) return 0;
  return until - now;
}

/** True when sign-in must be refused for this account right now. */
export function isAccountLocked(user: LockableUser, now: number = Date.now()): boolean {
  return lockoutRemainingMs(user, now) > 0;
}

/**
 * Count one wrong password, and lock the account when the count reaches the
 * threshold.
 *
 * One statement, not read-then-write: two simultaneous wrong guesses must not
 * both read `7` and both write `8`. `UPDATE ... SET` evaluates every expression
 * against the row as it was, so both `CASE`s agree about the old count, and two
 * concurrent statements still serialise on the row lock.
 *
 * Returns the state after the write, so the caller can tell the visitor whether
 * this attempt is the one that locked them.
 */
export async function recordFailedLogin(
  userId: string,
  now: number = Date.now(),
): Promise<{ attempts: number; lockedUntil: Date | null }> {
  const lockUntil = new Date(now + LOCKOUT_DURATION_MS).toISOString();

  const [row] = await db
    .update(users)
    .set({
      // Reaching the threshold sets the lock and resets the counter, so the run
      // after the lock expires starts fresh.
      failedLoginAttempts: sql`CASE
        WHEN ${users.failedLoginAttempts} + 1 >= ${LOCKOUT_THRESHOLD} THEN 0
        ELSE ${users.failedLoginAttempts} + 1 END`,
      lockedUntil: sql`CASE
        WHEN ${users.failedLoginAttempts} + 1 >= ${LOCKOUT_THRESHOLD}
        THEN ${lockUntil}::timestamptz
        ELSE ${users.lockedUntil} END`,
    })
    .where(eq(users.id, userId))
    .returning({ attempts: users.failedLoginAttempts, lockedUntil: users.lockedUntil });

  return {
    attempts: row?.attempts ?? 0,
    lockedUntil: row?.lockedUntil ? new Date(row.lockedUntil) : null,
  };
}

/** A successful sign-in, or a completed password reset, clears the run. */
export async function clearFailedLogins(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ failedLoginAttempts: 0, lockedUntil: null })
    .where(eq(users.id, userId));
}
