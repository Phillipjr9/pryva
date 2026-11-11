import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import * as schema from "@/db/schema";
import { orders, users, walletTransactions } from "@/db/schema";

/**
 * Migration 0044 adds the indexes for queries that used to read a whole table to
 * answer a small question. An index nobody uses is pure write cost, so this does
 * not stop at "the index exists": each one is checked against the query the
 * application actually sends, built with the same Drizzle schema, in real
 * PostgreSQL.
 *
 * Sequential scans are switched off for the plans below. On an empty table the
 * planner would rightly prefer one, and the question here is not "is the index
 * cheaper on zero rows" but "can this query use this index at all" — which is
 * what decides whether it scans a million rows once there are a million.
 */

const MIGRATION = "0044_scale_indexes.sql";

let pg: PGlite;
let database: PgliteDatabase<typeof schema>;

beforeAll(async () => {
  pg = new PGlite();
  const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  expect(files).toContain(MIGRATION);
  for (const file of files) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema });
  await pg.exec("SET enable_seqscan = off");
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

/** The plan PostgreSQL chooses for a Drizzle query, as one string. */
async function planOf(query: { toSQL(): { sql: string; params: unknown[] } }): Promise<string> {
  const { sql, params } = query.toSQL();
  const result = await pg.query<{ "QUERY PLAN": string }>(`EXPLAIN ${sql}`, params);
  return result.rows.map((row) => row["QUERY PLAN"]).join("\n");
}

const ORDER_ID = "00000000-0000-4000-8000-000000000002";

describe("migration 0044", () => {
  it("creates each index with the definition the code relies on", async () => {
    const result = await pg.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE indexname IN ('orders_status_created_idx', 'orders_created_idx',
                            'wallet_transactions_order_idx', 'wallet_transactions_created_idx',
                            'users_created_idx')
        ORDER BY indexname`,
    );
    const definitions = Object.fromEntries(result.rows.map((row) => [row.indexname, row.indexdef]));

    expect(Object.keys(definitions)).toEqual([
      "orders_created_idx",
      "orders_status_created_idx",
      "users_created_idx",
      "wallet_transactions_created_idx",
      "wallet_transactions_order_idx",
    ]);
    expect(definitions.orders_status_created_idx).toContain("(status, created_at)");
    expect(definitions.orders_created_idx).toContain("(created_at)");
    expect(definitions.users_created_idx).toContain("(created_at)");
    expect(definitions.wallet_transactions_created_idx).toContain("(created_at)");
    // Partial: ledger rows with no order (top-ups, payouts) stay out of it.
    expect(definitions.wallet_transactions_order_idx).toContain("(order_id)");
    expect(definitions.wallet_transactions_order_idx).toContain("WHERE (order_id IS NOT NULL)");
  });

  it("can be applied twice, so an index built by hand beforehand is not an error", async () => {
    // The runner wraps a migration in a transaction, which rules out CREATE INDEX
    // CONCURRENTLY. On a large table an operator builds these by hand first, and
    // this file must then be a no-op rather than a failed deploy.
    await expect(pg.exec(await readFile(`migrations/${MIGRATION}`, "utf8"))).resolves.toBeDefined();
  });

  it("is additive only: nothing is dropped, altered or rewritten", async () => {
    const sql = (await readFile(`migrations/${MIGRATION}`, "utf8"))
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    const statements = sql.split(";").map((statement) => statement.trim()).filter(Boolean);

    expect(statements).toHaveLength(5);
    for (const statement of statements) {
      expect(statement).toMatch(/^CREATE INDEX IF NOT EXISTS \w+ ON \w+ \(/);
    }
    expect(sql).not.toMatch(/\b(DROP|ALTER|DELETE|UPDATE|TRUNCATE)\b/i);
  });
});

describe("the queries that used to scan a whole table", () => {
  it("the code-delivery sweep reads only orders that are still open", async () => {
    // src/lib/services/numbers/number-code-sync.ts
    const plan = await planOf(
      database
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.status, "active"), eq(orders.service, "numbers"), gte(orders.createdAt, new Date())))
        .limit(25),
    );
    expect(plan).toContain("orders_status_created_idx");
  });

  it("a sweep over several open statuses uses the same index", async () => {
    // src/lib/services/boosts/boost-status.ts and the supplier re-check queues.
    const plan = await planOf(
      database
        .select({ id: orders.id })
        .from(orders)
        .where(and(inArray(orders.status, ["processing", "active", "review"]), eq(orders.provider, "boosts")))
        .orderBy(asc(orders.createdAt))
        .limit(25),
    );
    expect(plan).toContain("orders_status_created_idx");
  });

  it("the console's newest-first order list walks an index instead of sorting the table", async () => {
    // src/app/api/admin/orders/route.ts and src/lib/admin/dashboard.ts
    const plan = await planOf(
      database.select({ id: orders.id }).from(orders).orderBy(desc(orders.createdAt)).limit(50).offset(0),
    );
    expect(plan).toContain("Index Scan Backward using orders_created_idx");
    expect(plan).not.toContain("Sort");
  });

  it("order counts for a time window read the window, not the history", async () => {
    // src/lib/admin/dashboard.ts
    const plan = await planOf(
      database
        .select({ id: orders.id })
        .from(orders)
        .where(and(gte(orders.createdAt, new Date(Date.now() - 86_400_000)), lt(orders.createdAt, new Date()))),
    );
    expect(plan).toMatch(/orders_(status_)?created_idx/);
  });

  it("the ledger rows of one order are found by order id alone", async () => {
    // src/lib/payments/payment-integrity.ts — asked before every refund. A
    // parameterised `order_id = $1` has to be provably inside the partial
    // index's predicate, or the index is never chosen.
    const plan = await planOf(
      database
        .select({ id: walletTransactions.id })
        .from(walletTransactions)
        .where(and(eq(walletTransactions.orderId, ORDER_ID), eq(walletTransactions.type, "debit"))),
    );
    expect(plan).toContain("wallet_transactions_order_idx");
  });

  it("the console's newest-first ledger page walks an index", async () => {
    // src/app/admin/(console)/transactions/page.tsx
    const plan = await planOf(
      database
        .select({ id: walletTransactions.id })
        .from(walletTransactions)
        .orderBy(desc(walletTransactions.createdAt), desc(walletTransactions.id))
        .limit(50),
    );
    expect(plan).toContain("wallet_transactions_created_idx");
  });

  it("the newest accounts are listed from an index", async () => {
    // src/app/api/admin/users/route.ts
    const plan = await planOf(database.select({ id: users.id }).from(users).orderBy(desc(users.createdAt)).limit(50));
    expect(plan).toContain("Index Scan Backward using users_created_idx");
  });
});

describe("the signup-spike count on a table with history", () => {
  it("reads the last hour of signups, not every account ever created", async () => {
    // Real rows and real statistics here, with sequential scans allowed again:
    // this is the planner's own choice, on the query that runs after every
    // signup (src/lib/admin/signup-spike.ts).
    await pg.exec(`
      INSERT INTO users (id, name, email, password_hash, wallet_balance, created_at)
      SELECT gen_random_uuid(), 'Seed ' || n, 'seed-' || n || '@example.test', 'x', 0,
             now() - (n || ' minutes')::interval
        FROM generate_series(1, 4000) AS n;
      ANALYZE users;
      SET enable_seqscan = on;
    `);

    const { sql, params } = database
      .select({ id: users.id })
      .from(users)
      .where(gte(users.createdAt, new Date(Date.now() - 60 * 60 * 1000)))
      .toSQL();
    const result = await pg.query<{ "QUERY PLAN": string }>(`EXPLAIN ${sql}`, params);
    const plan = result.rows.map((row) => row["QUERY PLAN"]).join("\n");

    expect(plan).toContain("users_created_idx");
    expect(plan).not.toContain("Seq Scan");
  });
});
