import { db } from "@/db";
import { walletTransactions, orders, users, WALLET_CREDIT_TYPES, WALLET_DEBIT_TYPES } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { walletEntryDirection } from "@/lib/payments/wallet-activity";
import { isPreviewDatabase } from "@/lib/platform/demo-policy";

export interface IntegrityCheckResult {
  valid: boolean;
  issues: string[];
}

export async function checkWalletIntegrity(userId: string): Promise<IntegrityCheckResult> {
  const issues: string[] = [];

  // Get current wallet balance
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { walletBalance: true },
  });

  if (!user) {
    return { valid: false, issues: ["User not found"] };
  }

  // Calculate expected balance from transactions
  const transactions = await db.query.walletTransactions.findMany({
    where: eq(walletTransactions.userId, userId),
    orderBy: (tx, { asc }) => [asc(tx.createdAt)],
  });

  let calculatedBalance = 0;
  for (const tx of transactions) {
    const direction = walletEntryDirection(tx.type);
    if (direction === "in") calculatedBalance += tx.amount;
    else if (direction === "out") calculatedBalance -= tx.amount;
    else issues.push(`Unknown transaction type: ${tx.type}`);
  }

  if (calculatedBalance !== user.walletBalance) {
    issues.push(
      `Balance mismatch: recorded ${user.walletBalance}, calculated ${calculatedBalance}`
    );
  }

  // Check for duplicate transactions
  const references = transactions.map((tx) => tx.reference);
  const uniqueReferences = new Set(references);
  if (references.length !== uniqueReferences.size) {
    issues.push("Duplicate transaction references detected");
  }

  // Check for negative balance
  if (user.walletBalance < 0) {
    issues.push("Negative wallet balance detected");
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

export async function checkOrderIntegrity(orderId: string): Promise<IntegrityCheckResult> {
  const issues: string[] = [];

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
  });

  if (!order) {
    return { valid: false, issues: ["Order not found"] };
  }

  // Check for corresponding transaction
  const transaction = await db.query.walletTransactions.findFirst({
    where: and(eq(walletTransactions.orderId, orderId), eq(walletTransactions.type, "debit")),
  });

  if (!transaction && order.status !== "refunded") {
    issues.push("No transaction found for order");
  }

  if (transaction && transaction.amount !== order.amount) {
    issues.push(
      `Transaction amount mismatch: order ${order.amount}, transaction ${transaction.amount}`
    );
  }

  // Check refunded orders have refund transaction
  if (order.status === "refunded") {
    const refundTx = await db.query.walletTransactions.findFirst({
      where: and(
        eq(walletTransactions.orderId, orderId),
        eq(walletTransactions.type, "refund")
      ),
    });

    if (!refundTx) {
      issues.push("Refunded order missing refund transaction");
    } else if (refundTx.amount !== order.amount) {
      issues.push(`Refund amount mismatch: order ${order.amount}, transaction ${refundTx.amount}`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

export type IntegrityScope = "all" | "wallet" | "orders";

export type IntegritySummary = {
  users: { checked: number; issues: number };
  orders: { checked: number; issues: number };
};

/** How many failing accounts or orders one run names in the log. */
export const INTEGRITY_ISSUE_SAMPLE = 25;

const NOT_CHECKED = { checked: 0, issues: 0 } as const;

const typeList = (types: readonly string[]) =>
  sql`(${sql.join(types.map((type) => sql`${type}`), sql`, `)})`;

/**
 * Every account beside what its ledger adds up to: one grouped pass over the
 * ledger, joined to the accounts. An account with no transactions is still a
 * row, and must hold a balance of zero.
 */
function walletsWithLedger() {
  return sql`
    SELECT u.id,
           u.wallet_balance,
           coalesce(l.calculated, 0) AS calculated,
           coalesce(l.unknown_types, 0) AS unknown_types,
           coalesce(l.duplicate_references, 0) AS duplicate_references
      FROM users u
      LEFT JOIN (
        SELECT user_id,
               sum(CASE WHEN type IN ${typeList(WALLET_CREDIT_TYPES)} THEN amount
                        WHEN type IN ${typeList(WALLET_DEBIT_TYPES)} THEN -amount
                        ELSE 0 END) AS calculated,
               count(*) FILTER (
                 WHERE type NOT IN ${typeList([...WALLET_CREDIT_TYPES, ...WALLET_DEBIT_TYPES])}
               ) AS unknown_types,
               count(*) - count(DISTINCT reference) AS duplicate_references
          FROM wallet_transactions
         GROUP BY user_id
      ) l ON l.user_id = u.id
  `;
}

/** The four things `checkWalletIntegrity` reports, as one predicate. */
const WALLET_HAS_ISSUE = sql`(
  wallet_balance < 0
  OR wallet_balance <> calculated
  OR unknown_types > 0
  OR duplicate_references > 0
)`;

/**
 * Every order beside its first purchase entry and its first refund entry: one
 * grouped pass over the ledger rows that name an order, joined to the orders.
 */
function ordersWithLedger() {
  return sql`
    SELECT o.id, o.amount, o.status, l.debit_amount, l.refund_amount
      FROM orders o
      LEFT JOIN (
        SELECT order_id,
               (array_agg(amount ORDER BY created_at, id) FILTER (WHERE type = 'debit'))[1] AS debit_amount,
               (array_agg(amount ORDER BY created_at, id) FILTER (WHERE type = 'refund'))[1] AS refund_amount
          FROM wallet_transactions
         WHERE order_id IS NOT NULL
         GROUP BY order_id
      ) l ON l.order_id = o.id
  `;
}

/** The four things `checkOrderIntegrity` reports, as one predicate. */
const ORDER_HAS_ISSUE = sql`(
  (debit_amount IS NULL AND status <> 'refunded')
  OR (debit_amount IS NOT NULL AND debit_amount <> amount)
  OR (status = 'refunded' AND (refund_amount IS NULL OR refund_amount <> amount))
)`;

type WalletIssueRow = {
  id: string;
  wallet_balance: number;
  calculated: string;
  unknown_types: number;
  duplicate_references: number;
};

type OrderIssueRow = {
  id: string;
  amount: number;
  status: string;
  debit_amount: number | null;
  refund_amount: number | null;
};

function describeWalletIssues(row: WalletIssueRow): string[] {
  const issues: string[] = [];
  if (Number(row.unknown_types) > 0) issues.push(`Unknown transaction type on ${row.unknown_types} transaction(s)`);
  if (Number(row.calculated) !== Number(row.wallet_balance)) {
    issues.push(`Balance mismatch: recorded ${row.wallet_balance}, calculated ${row.calculated}`);
  }
  if (Number(row.duplicate_references) > 0) issues.push("Duplicate transaction references detected");
  if (Number(row.wallet_balance) < 0) issues.push("Negative wallet balance detected");
  return issues;
}

function describeOrderIssues(row: OrderIssueRow): string[] {
  const issues: string[] = [];
  if (row.debit_amount === null && row.status !== "refunded") issues.push("No transaction found for order");
  if (row.debit_amount !== null && Number(row.debit_amount) !== Number(row.amount)) {
    issues.push(`Transaction amount mismatch: order ${row.amount}, transaction ${row.debit_amount}`);
  }
  if (row.status === "refunded") {
    if (row.refund_amount === null) issues.push("Refunded order missing refund transaction");
    else if (Number(row.refund_amount) !== Number(row.amount)) {
      issues.push(`Refund amount mismatch: order ${row.amount}, transaction ${row.refund_amount}`);
    }
  }
  return issues;
}

async function checkAllWallets(): Promise<{ checked: number; issues: number }> {
  const totals = await db.execute<{ checked: number; issues: number }>(sql`
    WITH checked AS (${walletsWithLedger()})
    SELECT count(*)::int AS checked,
           (count(*) FILTER (WHERE ${WALLET_HAS_ISSUE}))::int AS issues
      FROM checked
  `);
  const checked = Number(totals.rows[0]?.checked ?? 0);
  const issues = Number(totals.rows[0]?.issues ?? 0);
  if (issues === 0) return { checked, issues };

  // Only when something is wrong: name a bounded number of the accounts, with
  // the reason, so the operator has somewhere to start.
  const sample = await db.execute<WalletIssueRow>(sql`
    WITH checked AS (${walletsWithLedger()})
    SELECT id, wallet_balance, calculated::text AS calculated,
           unknown_types::int AS unknown_types, duplicate_references::int AS duplicate_references
      FROM checked
     WHERE ${WALLET_HAS_ISSUE}
     ORDER BY id
     LIMIT ${INTEGRITY_ISSUE_SAMPLE}
  `);
  for (const row of sample.rows) {
    console.error(`Wallet integrity issues for user ${row.id}:`, describeWalletIssues(row));
  }
  if (issues > sample.rows.length) {
    console.error(`Wallet integrity issues: ${issues - sample.rows.length} more account(s) not listed`);
  }
  return { checked, issues };
}

async function checkAllOrders(): Promise<{ checked: number; issues: number }> {
  const totals = await db.execute<{ checked: number; issues: number }>(sql`
    WITH checked AS (${ordersWithLedger()})
    SELECT count(*)::int AS checked,
           (count(*) FILTER (WHERE ${ORDER_HAS_ISSUE}))::int AS issues
      FROM checked
  `);
  const checked = Number(totals.rows[0]?.checked ?? 0);
  const issues = Number(totals.rows[0]?.issues ?? 0);
  if (issues === 0) return { checked, issues };

  const sample = await db.execute<OrderIssueRow>(sql`
    WITH checked AS (${ordersWithLedger()})
    SELECT id, amount, status, debit_amount, refund_amount
      FROM checked
     WHERE ${ORDER_HAS_ISSUE}
     ORDER BY id
     LIMIT ${INTEGRITY_ISSUE_SAMPLE}
  `);
  for (const row of sample.rows) {
    console.error(`Order integrity issues for order ${row.id}:`, describeOrderIssues(row));
  }
  if (issues > sample.rows.length) {
    console.error(`Order integrity issues: ${issues - sample.rows.length} more order(s) not listed`);
  }
  return { checked, issues };
}

/**
 * The in-memory preview has no SQL to run, so it keeps the record-at-a-time
 * walk. Its tables are arrays in this process and hold a handful of rows.
 */
async function checkPreviewData(scope: IntegrityScope): Promise<IntegritySummary> {
  let userIssues = 0;
  let orderIssues = 0;
  const allUsers = scope === "orders" ? [] : await db.query.users.findMany();
  const allOrders = scope === "wallet" ? [] : await db.query.orders.findMany();

  for (const user of allUsers) {
    const result = await checkWalletIntegrity(user.id);
    if (!result.valid) {
      userIssues++;
      console.error(`Wallet integrity issues for user ${user.id}:`, result.issues);
    }
  }

  for (const order of allOrders) {
    const result = await checkOrderIntegrity(order.id);
    if (!result.valid) {
      orderIssues++;
      console.error(`Order integrity issues for order ${order.id}:`, result.issues);
    }
  }

  return {
    users: { checked: allUsers.length, issues: userIssues },
    orders: { checked: allOrders.length, issues: orderIssues },
  };
}

/**
 * The on-demand check behind the console's "Integrity checks" page: how many
 * accounts and orders fail `checkWalletIntegrity` / `checkOrderIntegrity`.
 *
 * ## Why it is not a loop over those two functions any more
 *
 * It used to load every account and every order into memory — every column of
 * each — and then call the single-record checks one row at a time: two queries
 * for each account, two or three for each order, one after another. That is
 * fine with a hundred rows. With a hundred thousand it is several hundred
 * thousand round trips inside one request, which the host stops before it
 * finishes; so the check stopped answering at exactly the size where an
 * operator most needs it, and held a database connection busy until then.
 *
 * The same answers come from a fixed number of statements however large the
 * tables are: the ledger is grouped once by account, once by order, and each
 * result is joined to its table. The rules are the single-record ones, written
 * as predicates, and `integrity-check.test.ts` holds the two to the same verdict
 * on every row of a mixed data set.
 *
 * `scope` now decides what runs, not just what is reported: asking about orders
 * no longer walks every wallet first.
 *
 * At most `INTEGRITY_ISSUE_SAMPLE` failing records per kind are named in the
 * log, with a count of the rest. The host keeps a limited number of log lines
 * for one request, so a line for each of ten thousand failures was never going
 * to be readable there.
 */
export async function runFullIntegrityCheck(scope: IntegrityScope = "all"): Promise<IntegritySummary> {
  if (isPreviewDatabase()) return checkPreviewData(scope);

  return {
    users: scope === "orders" ? { ...NOT_CHECKED } : await checkAllWallets(),
    orders: scope === "wallet" ? { ...NOT_CHECKED } : await checkAllOrders(),
  };
}

export function validateTransactionAmount(amount: number): boolean {
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 10000000; // Maximum 10M naira
}

export function validateWalletBalance(balance: number): boolean {
  return Number.isInteger(balance) && balance >= 0;
}
