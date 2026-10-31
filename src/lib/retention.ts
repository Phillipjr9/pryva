import { and, count, inArray, isNotNull, lte, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { users, withdrawals } from "@/db/schema";
import { logger } from "@/lib/logger";

/**
 * How long a closed account's records are kept — and the sweep that ends it.
 *
 * The owner's decision (31 Oct 2026): keep a closed account's records for **ten
 * years**, and do not tell customers the number. So the horizon lives here, on the
 * server, and never in `DELETION_TERMS` — the customer-facing copy says the record
 * is kept "for as long as the law and disputes require", which is true and is all
 * they are told. Nothing in this module may be imported by a client component: it
 * is server-only so the number cannot end up in a browser bundle.
 *
 * Why ten years is a policy and not a promise: it is the horizon after which the
 * reasons to keep financial records (chargebacks, disputes, tax) stop applying. A
 * row that old has no live claim against it.
 *
 * The sweep is **off unless `RETENTION_PURGE_ENABLED=true`**. Deleting financial
 * records is irreversible, and a job that starts doing it because a migration ran
 * is not something to discover later. With the flag unset the nightly run still
 * counts what is due and reports it, so the horizon is measurable before anyone
 * arms it.
 */

/** Retention horizon for a closed account's records. Server-only by design. */
export const RETENTION_YEARS = 10;

/**
 * States a payout can be in and still be "finished".
 *
 * `pending`, `processing` and anything unrecognised are treated as live, which is
 * why this is an allowlist of terminal states rather than a blocklist of open ones.
 */
const TERMINAL_WITHDRAWAL_STATUSES: string[] = ["completed", "failed", "rejected"];

/** The instant a closed account's records become due for removal. */
export function purgeDueAt(deletedAt: Date): Date {
  const due = new Date(deletedAt.getTime());
  due.setUTCFullYear(due.getUTCFullYear() + RETENTION_YEARS);
  return due;
}

/**
 * Whether a closure is past the retention horizon.
 *
 * An open account is never eligible: `deletedAt` is null, and closure is the only
 * thing this clock measures.
 */
export function isPastRetention(deletedAt: Date | null | undefined, now = new Date()): boolean {
  if (!deletedAt) return false;
  return purgeDueAt(deletedAt).getTime() <= now.getTime();
}

/** Whether the destructive half of the sweep is armed on this deployment. */
export function purgeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.RETENTION_PURGE_ENABLED?.trim().toLowerCase() === "true";
}

/**
 * The instant a closure becomes due: `deletedAt` at or before this is past the
 * horizon. One definition, used by the count and the sweep, so they cannot
 * disagree about which rows are eligible.
 */
export function retentionCutoff(now = new Date()): Date {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - RETENTION_YEARS);
  return cutoff;
}

/** How many closed accounts are past the horizon right now. Reads only. */
export async function countDueForPurge(now = new Date()): Promise<number> {
  const cutoff = retentionCutoff(now);
  const [row] = await db
    .select({ total: count() })
    .from(users)
    .where(and(isNotNull(users.deletedAt), lte(users.deletedAt, cutoff)));
  return Number(row?.total ?? 0);
}

export type RetentionSweep = {
  /** Closed accounts past the horizon. */
  due: number;
  /** Rows actually removed (zero unless armed). */
  purged: number;
  /** Closed accounts left alone because a payout was still attached. */
  held: number;
  armed: boolean;
};

/**
 * Remove closed accounts whose records are past the horizon.
 *
 * Deleting the `users` row is the only complete removal this system has: every
 * financial table cascades from it, so the orders, ledger, deposits, withdrawals,
 * gift cards and the closure receipt all go together. That is the point of a
 * retention horizon — it is the one operation that makes the data stop existing.
 *
 * Guards, in order: nothing happens unless the sweep is armed; only rows with a
 * `deleted_at` are candidates (an open account is never touched); a row with a
 * withdrawal in any non-terminal state is held, because deleting it would erase
 * the record of a payout that might still be moving; and at most `limit` rows are
 * removed per run so a bad clock cannot empty the table in one night.
 */
export async function purgeExpiredClosedAccounts(
  options: { now?: Date; limit?: number; armed?: boolean } = {},
): Promise<RetentionSweep> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 25;
  const armed = options.armed ?? purgeEnabled();

  const due = await countDueForPurge(now);
  if (!armed || due === 0) {
    return { due, purged: 0, held: 0, armed };
  }

  const cutoff = retentionCutoff(now);

  const candidates = await db
    .select({ id: users.id })
    .from(users)
    .where(and(isNotNull(users.deletedAt), lte(users.deletedAt, cutoff)))
    .limit(limit);

  if (candidates.length === 0) return { due, purged: 0, held: 0, armed };

  // A payout that is not finished is a live claim, even a decade later: the row it
  // points at is the only way to trace the money.
  const ids = candidates.map((row) => row.id);
  const open = await db
    .select({ userId: withdrawals.userId })
    .from(withdrawals)
    .where(and(inArray(withdrawals.userId, ids), notInArray(withdrawals.status, TERMINAL_WITHDRAWAL_STATUSES)));
  const heldIds = new Set(open.map((row) => row.userId));
  const removable = ids.filter((id) => !heldIds.has(id));

  let purged = 0;
  if (removable.length > 0) {
    // Only the removable ids, and only the ones that are still closed: the WHERE
    // clause is repeated so a row that reopened between the read and the write is
    // left alone. Cascade does the rest — orders, ledger, deposits, payouts, gift
    // cards, support threads and the closure receipt all reference `users.id`.
    await db
      .delete(users)
      .where(and(inArray(users.id, removable), isNotNull(users.deletedAt), lte(users.deletedAt, cutoff)));
    purged = removable.length;
    logger.warn("Retention sweep removed closed accounts", { purged, due, cutoff: cutoff.toISOString() });
  }

  return { due, purged, held: candidates.length - removable.length, armed };
}
