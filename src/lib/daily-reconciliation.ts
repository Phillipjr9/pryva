import type { AnyColumn } from "drizzle-orm";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { isPreviewDatabase } from "@/lib/demo-policy";
import {
  giftCards,
  orders,
  paymentTopups,
  reconciliationRuns,
  TOPUP_STATUS,
  walletTransactions,
  WALLET_CREDIT_TYPES,
  WALLET_DEBIT_TYPES,
  type WalletEntryType,
  withdrawals,
} from "@/db/schema";

/**
 * The daily close.
 *
 * ## What this answers
 *
 * Two questions an operator has to be able to answer every morning:
 *
 *   1. **Did the money move the way the books say it did?** — the day's deposits,
 *      spend, refunds, gift cards and withdrawals, counted from the tables that
 *      recorded them.
 *   2. **Does the wallet ledger still add up?** — for every account, each
 *      transaction's `balance_after` must equal the previous balance plus this
 *      transaction's amount, and the last one must equal the balance on the
 *      user's row. This is the check that catches the failures a report cannot:
 *      a double debit, a credit written without its ledger row, a manual UPDATE
 *      that moved a balance and left the history behind.
 *
 * ## What it deliberately does not do
 *
 * It does not call the payment provider. The external side of reconciliation is
 * a comparison between two numbers — ours and the provider dashboard's — and
 * pretending to automate it without a verified API contract would be worse than
 * showing the operator the number to compare. So the run records the internal
 * side, flags any ledger break, and the runbook says what to compare it with.
 *
 * It also never writes to a money table. Read, compute, record: the only row it
 * touches is its own `reconciliation_runs` row.
 */

/** Lagos is UTC+1 with no daylight saving, so a day is a fixed 24 hours. */
export const LAGOS_OFFSET_MS = 60 * 60 * 1000;

export type Money = { count: number; amount: number };

export type ReconciliationTotals = {
  /** Deposits the provider confirmed — i.e. `payment_topups.status = completed`. */
  topupsCompleted: Money;
  topupsPending: Money;
  walletCredits: Money;
  walletDebits: Money;
  refunds: Money;
  /**
   * Ledger rows for payouts, counted separately from `walletDebits` because the
   * withdraw route writes its own type. Without it, the four columns above do
   * not tie out to `netWalletMovement` on a day with a payout in it, and an
   * operator reading this row by hand cannot reproduce the figure.
   */
  walletWithdrawals: Money;
  ordersPlaced: Money;
  giftCardsIssued: Money;
  withdrawalsCompleted: Money;
  withdrawalsPending: Money;
  /** Credit-direction minus debit-direction, as the ledger recorded it. */
  netWalletMovement: number;
};

export type LedgerBreak = {
  userId: string;
  kind: "balance_after" | "final_balance" | "unknown_type";
  detail: string;
};

export type ReconciliationResult = {
  day: string;
  status: "clean" | "attention";
  totals: ReconciliationTotals;
  accountsChecked: number;
  discrepancies: number;
  breaks: LedgerBreak[];
  /** Set when the external side has not been compared, which is the default. */
  externalNote: string;
};

/** `YYYY-MM-DD` in Lagos for a given instant. */
export function lagosDay(instant: Date = new Date()): string {
  const shifted = new Date(instant.getTime() + LAGOS_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

/** The UTC window that a Lagos business day covers. */
export function lagosDayWindow(day: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Invalid day: ${day}`);
  const start = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) throw new Error(`Invalid day: ${day}`);
  // Midnight in Lagos is 23:00 UTC the day before.
  const startUtc = new Date(start.getTime() - LAGOS_OFFSET_MS);
  return { start: startUtc, end: new Date(startUtc.getTime() + 24 * 60 * 60 * 1000) };
}

function money(count: number | string | null | undefined, amount: number | string | null | undefined): Money {
  return { count: Number(count ?? 0), amount: Number(amount ?? 0) };
}

/**
 * The wallet ledger, checked for continuity.
 *
 * Two queries, because they catch different errors:
 *
 *   * window function per account: a `balance_after` that does not follow from
 *     the previous row plus this amount;
 *   * a lateral join to each account's last row, compared with `users.wallet_balance`:
 *     a correct chain that does not end where the balance column says it does.
 *
 * Both are read-only and both are bounded by the accounts that have transactions.
 */
async function checkLedger(): Promise<{ accountsChecked: number; breaks: LedgerBreak[] }> {
  // The in-memory preview has no ledger to be consistent with: its "database" is
  // a set of arrays that never enforces the balance invariant in the first
  // place. Reporting a clean ledger there would be a lie in the other direction,
  // so it reports that nothing was checked.
  if (isPreviewDatabase()) return { accountsChecked: 0, breaks: [] };

  const breaks: LedgerBreak[] = [];

  // The vocabulary comes from the schema, not from a string literal in this file.
  // `type` is a free varchar, so a hand-written rule here drifted: it treated
  // everything that is not `'debit'` as money coming in, which read the payout
  // rows the withdraw route writes (`'withdrawal'`, also a positive amount that
  // moves the balance down) as credits.
  const inList = (types: readonly string[]) =>
    sql`(${sql.join(types.map((type) => sql`${type}`), sql`, `)})`;

  const outOfSequence = await db.execute<{ user_id: string; occurrences: number }>(sql`
    WITH ordered AS (
      SELECT user_id, type, balance_after, amount,
             lag(balance_after) OVER (PARTITION BY user_id ORDER BY created_at, id) AS previous
        FROM wallet_transactions
    )
    SELECT user_id, count(*)::int AS occurrences
      FROM ordered
     WHERE previous IS NOT NULL
       AND (
         -- Amounts are stored positive in both directions, so the arithmetic
         -- depends on the direction the type belongs to, never on its sign.
         (type IN ${inList(WALLET_DEBIT_TYPES)} AND previous - amount <> balance_after)
         OR (type IN ${inList(WALLET_CREDIT_TYPES)} AND previous + amount <> balance_after)
       )
     GROUP BY user_id
  `);
  for (const row of outOfSequence.rows) {
    breaks.push({
      userId: row.user_id,
      kind: "balance_after",
      detail: `${row.occurrences} transaction(s) whose balance does not follow from the previous one`,
    });
  }

  // A type in neither list has no direction, so the two checks above silently
  // skip it. That is not the same as it being clean: a row this file cannot read
  // is a row the books cannot read either, so it is reported instead of ignored.
  const unknownTypes = await db.execute<{ user_id: string; type: string; occurrences: number }>(sql`
    SELECT user_id, type, count(*)::int AS occurrences
      FROM wallet_transactions
     WHERE type NOT IN ${inList([...WALLET_DEBIT_TYPES, ...WALLET_CREDIT_TYPES])}
     GROUP BY user_id, type
  `);
  for (const row of unknownTypes.rows) {
    breaks.push({
      userId: row.user_id,
      kind: "unknown_type",
      detail: `${row.occurrences} transaction(s) of type '${row.type}' are in no known direction and were not checked`,
    });
  }

  const finalMismatch = await db.execute<{
    user_id: string;
    wallet_balance: number;
    ledger_balance: number;
  }>(sql`
    SELECT u.id AS user_id, u.wallet_balance, last.balance_after AS ledger_balance
      FROM users u
      JOIN LATERAL (
        SELECT balance_after FROM wallet_transactions w
         WHERE w.user_id = u.id
         ORDER BY w.created_at DESC, w.id DESC
         LIMIT 1
      ) last ON true
     WHERE u.wallet_balance <> last.balance_after
  `);
  for (const row of finalMismatch.rows) {
    breaks.push({
      userId: row.user_id,
      kind: "final_balance",
      detail: `wallet_balance ${row.wallet_balance} but the ledger ends at ${row.ledger_balance}`,
    });
  }

  const [{ accounts }] = await db
    .select({ accounts: sql<number>`count(DISTINCT ${walletTransactions.userId})::int` })
    .from(walletTransactions);

  return { accountsChecked: Number(accounts ?? 0), breaks };
}

/**
 * Runs the close for one Lagos business day.
 *
 * Re-running a day is safe and expected: the row is inserted (or reset to
 * 'running') first, then updated with the findings, so a crash mid-run leaves a
 * visible 'running' row rather than silently nothing.
 */
export async function runDailyReconciliation(day: string = lagosDay()): Promise<ReconciliationResult> {
  const { start, end } = lagosDayWindow(day);

  // One helper for every timestamp column in the sweep: they differ in table and
  // nullability, and the predicate is the same for all of them.
  const inWindow = (column: AnyColumn) => and(gte(column, start), lt(column, end));

  const topupsCompleted = await db
    .select({ count: sql<number>`count(*)::int`, amount: sql<number>`coalesce(sum(${paymentTopups.amount}), 0)::bigint` })
    .from(paymentTopups)
    .where(and(eq(paymentTopups.status, TOPUP_STATUS.completed), inWindow(paymentTopups.paidAt)));

  const topupsPending = await db
    .select({ count: sql<number>`count(*)::int`, amount: sql<number>`coalesce(sum(${paymentTopups.amount}), 0)::bigint` })
    .from(paymentTopups)
    .where(and(eq(paymentTopups.status, TOPUP_STATUS.pending), inWindow(paymentTopups.createdAt)));

  const ledgerByType = await db
    .select({
      type: walletTransactions.type,
      count: sql<number>`count(*)::int`,
      amount: sql<number>`coalesce(sum(${walletTransactions.amount}), 0)::bigint`,
    })
    .from(walletTransactions)
    .where(inWindow(walletTransactions.createdAt))
    .groupBy(walletTransactions.type);

  const byType = new Map(ledgerByType.map((row) => [row.type, row]));
  // Typed as the vocabulary, so a name that is not in `WALLET_*_TYPES` stops
  // compiling instead of silently reading `undefined` and reporting zero.
  const rowFor = (type: WalletEntryType) => byType.get(type);
  const credits = rowFor("credit");
  const refunds = rowFor("refund");
  const debits = rowFor("debit");
  const payoutRows = rowFor("withdrawal");

  const amountFor = (types: readonly WalletEntryType[]) =>
    types.reduce((sum, type) => sum + Number(byType.get(type)?.amount ?? 0), 0);

  const ordersPlaced = await db
    .select({ count: sql<number>`count(*)::int`, amount: sql<number>`coalesce(sum(${orders.amount}), 0)::bigint` })
    .from(orders)
    .where(inWindow(orders.createdAt));

  const giftsIssued = await db
    .select({ count: sql<number>`count(*)::int`, amount: sql<number>`coalesce(sum(${giftCards.initialAmount}), 0)::bigint` })
    .from(giftCards)
    .where(inWindow(giftCards.createdAt));

  const withdrawalsCompleted = await db
    .select({ count: sql<number>`count(*)::int`, amount: sql<number>`coalesce(sum(${withdrawals.amount}), 0)::bigint` })
    .from(withdrawals)
    .where(and(eq(withdrawals.status, "completed"), inWindow(withdrawals.completedAt)));

  const withdrawalsPending = await db
    .select({ count: sql<number>`count(*)::int`, amount: sql<number>`coalesce(sum(${withdrawals.amount}), 0)::bigint` })
    .from(withdrawals)
    .where(eq(withdrawals.status, "pending"));

  const totals: ReconciliationTotals = {
    topupsCompleted: money(topupsCompleted[0]?.count, topupsCompleted[0]?.amount),
    topupsPending: money(topupsPending[0]?.count, topupsPending[0]?.amount),
    walletCredits: money(credits?.count, credits?.amount),
    walletDebits: money(debits?.count, debits?.amount),
    refunds: money(refunds?.count, refunds?.amount),
    walletWithdrawals: money(payoutRows?.count, payoutRows?.amount),
    ordersPlaced: money(ordersPlaced[0]?.count, ordersPlaced[0]?.amount),
    giftCardsIssued: money(giftsIssued[0]?.count, giftsIssued[0]?.amount),
    withdrawalsCompleted: money(withdrawalsCompleted[0]?.count, withdrawalsCompleted[0]?.amount),
    withdrawalsPending: money(withdrawalsPending[0]?.count, withdrawalsPending[0]?.amount),
    // Every type the ledger knows, on the side its direction list puts it on —
    // derived from the vocabulary rather than from a hand-written list of names,
    // which is what left payout rows out of this number before.
    netWalletMovement: amountFor(WALLET_CREDIT_TYPES) - amountFor(WALLET_DEBIT_TYPES),
  };

  const { accountsChecked, breaks } = await checkLedger();
  const status: ReconciliationResult["status"] = breaks.length === 0 ? "clean" : "attention";

  // Record first, then finish: a crash leaves a 'running' row an operator can see.
  await db
    .insert(reconciliationRuns)
    .values({ day, status: "running", startedAt: new Date() })
    .onConflictDoUpdate({
      target: reconciliationRuns.day,
      set: { status: "running", startedAt: new Date(), finishedAt: null },
    });

  const externalNote =
    "External side not compared: check the day's settled deposits against the payment provider's dashboard.";

  // The run page lists the accounts whose final balance disagrees, and nothing
  // else, so the kinds that do not look like that — a transaction that does not
  // follow from the one before, a type with no direction — have to be legible in
  // the row itself or an operator is sent to a table with nothing in it.
  const byKind = new Map<string, number>();
  for (const entry of breaks) byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + 1);
  const breakKinds = [...byKind].map(([kind, count]) => `${count} ${kind}`).join(", ");

  await db
    .update(reconciliationRuns)
    .set({
      status,
      finishedAt: new Date(),
      accountsChecked,
      discrepancies: breaks.length,
      totals: totals as unknown as Record<string, unknown>,
      notes: breaks.length
        ? `${breaks.length} ledger break(s) (${breakKinds}); see /admin/reconciliation. ${externalNote}`
        : externalNote,
    })
    .where(eq(reconciliationRuns.day, day));

  return { day, status, totals, accountsChecked, discrepancies: breaks.length, breaks, externalNote };
}

/** The most recent closes, newest first. */
export async function recentReconciliationRuns(limit = 14) {
  return db
    .select()
    .from(reconciliationRuns)
    .orderBy(sql`${reconciliationRuns.day} DESC`)
    .limit(limit);
}

/** Account balances that disagree with their own ledger — the detail behind a break. */
export async function ledgerBreaks(limit = 50) {
  if (isPreviewDatabase()) return [];
  const rows = await db.execute<{ user_id: string; email: string; wallet_balance: number; ledger_balance: number }>(sql`
    SELECT u.id AS user_id, u.email, u.wallet_balance, last.balance_after AS ledger_balance
      FROM users u
      JOIN LATERAL (
        SELECT balance_after FROM wallet_transactions w
         WHERE w.user_id = u.id
         ORDER BY w.created_at DESC, w.id DESC
         LIMIT 1
      ) last ON true
     WHERE u.wallet_balance <> last.balance_after
     ORDER BY u.wallet_balance DESC
     LIMIT ${limit}
  `);
  return rows.rows;
}
