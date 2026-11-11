import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";
import { orders, users, walletTransactions } from "@/db/schema";

/**
 * The console's on-demand integrity check used to be the plainest N+1 in the
 * code base: load every account and every order, then run two or three queries
 * for each of them, one after another. It answered on a small database and would
 * have stopped answering — by timing out — on a large one, which is when an
 * operator presses the button.
 *
 * It is now a fixed number of statements. These tests hold three things:
 *
 *   1. it reaches the same verdict as the single-record checks it replaced, on
 *      every row of a data set built to trip each rule;
 *   2. the number of statements does not grow with the number of rows;
 *   3. the scope decides what is read, and the log stays bounded.
 *
 * Real SQL against PGlite with every migration applied.
 */

const mocks = vi.hoisted(() => ({ db: undefined as unknown, preview: false, admin: vi.fn() }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/platform/demo-policy", () => ({ isPreviewDatabase: () => mocks.preview }));
vi.mock("@/lib/identity/admin-auth", () => ({ authorizeAdminApi: mocks.admin }));
vi.mock("@/lib/platform/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let integrity: typeof import("@/lib/payments/payment-integrity");
let route: typeof import("@/app/api/admin/integrity/route");
let errorLog: MockInstance<typeof console.error>;

const uuid = (group: number, index: number) =>
  `00000000-0000-4000-8${String(group).padStart(3, "0")}-${String(index).padStart(12, "0")}`;

/** Accounts built to trip, or not trip, each wallet rule. They own no orders. */
const WALLET = {
  emptyAndZero: uuid(1, 1),
  ledgerAddsUp: uuid(1, 2),
  balanceWithNoLedger: uuid(1, 3),
  balanceAheadOfLedger: uuid(1, 4),
  unknownEntryType: uuid(1, 5),
  repeatedReference: uuid(1, 6),
  negativeBalance: uuid(1, 7),
  twoDistinctEntries: uuid(1, 8),
} as const;

const WALLETS_WITH_ISSUES = [
  WALLET.balanceWithNoLedger,
  WALLET.balanceAheadOfLedger,
  WALLET.unknownEntryType,
  WALLET.repeatedReference,
  WALLET.negativeBalance,
].sort();

/** One account that owns every order below. */
const BUYER = uuid(2, 1);

const ORDER = {
  paidFor: uuid(3, 1),
  neverCharged: uuid(3, 2),
  chargedTheWrongAmount: uuid(3, 3),
  refundedInFull: uuid(3, 4),
  refundedWithoutAnEntry: uuid(3, 5),
  refundedTheWrongAmount: uuid(3, 6),
  refundedWithNoPurchaseEntry: uuid(3, 7),
  failedAndNeverCharged: uuid(3, 8),
  chargedTwiceTheSameAmount: uuid(3, 9),
} as const;

const ORDERS_WITH_ISSUES = [
  ORDER.neverCharged,
  ORDER.chargedTheWrongAmount,
  ORDER.refundedWithoutAnEntry,
  ORDER.refundedTheWrongAmount,
  ORDER.failedAndNeverCharged,
].sort();

let nextReference = 0;
const reference = () => `integrity-${(nextReference += 1)}`;

function account(id: string, walletBalance: number) {
  return { id, name: "Integrity Test", email: `${id}@example.test`, passwordHash: "x", walletBalance };
}

function entry(
  userId: string,
  type: string,
  amount: number,
  extra: { orderId?: string; reference?: string; createdAt?: Date } = {},
) {
  return {
    userId,
    type,
    amount,
    // Continuity of `balance_after` is the daily close's check, not this one.
    balanceAfter: 0,
    description: `${type} entry`,
    reference: extra.reference ?? reference(),
    orderId: extra.orderId ?? null,
    createdAt: extra.createdAt ?? new Date("2026-06-01T12:00:00Z"),
  };
}

function order(id: string, status: string, amount = 1_000, userId = BUYER) {
  return {
    id,
    // Group and index, so two seeded sets never share a reference.
    reference: `PV-${id.slice(19, 23)}-${id.slice(-6)}`,
    userId,
    service: "numbers" as const,
    productSlug: "integrity",
    productName: "Integrity test",
    planLabel: "One",
    region: "NG",
    duration: "20 min",
    amount,
    provider: "test",
    status,
  };
}

/**
 * The write path refuses most of what this check exists to find (unknown entry
 * types, credits with no provenance), which is the point of having a check: it
 * looks for what got in some other way. So the rows go in with triggers off.
 */
async function withoutTriggers(run: () => Promise<void>) {
  const tables = ["users", "orders", "wallet_transactions"];
  for (const table of tables) await pg.exec(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
  try {
    await run();
  } finally {
    for (const table of tables) await pg.exec(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
  }
}

async function seedMixedBooks() {
  await withoutTriggers(async () => {
    await database.insert(users).values([
      account(WALLET.emptyAndZero, 0),
      account(WALLET.ledgerAddsUp, 5_500),
      account(WALLET.balanceWithNoLedger, 700),
      account(WALLET.balanceAheadOfLedger, 4_500),
      account(WALLET.unknownEntryType, 2_000),
      account(WALLET.repeatedReference, 600),
      account(WALLET.negativeBalance, -500),
      account(WALLET.twoDistinctEntries, 300),
      // Whatever the orders below charge and refund; its own verdict is left to
      // the comparison with the single-record check.
      account(BUYER, 0),
    ]);

    await database.insert(orders).values([
      order(ORDER.paidFor, "active"),
      order(ORDER.neverCharged, "active"),
      order(ORDER.chargedTheWrongAmount, "active"),
      order(ORDER.refundedInFull, "refunded"),
      order(ORDER.refundedWithoutAnEntry, "refunded"),
      order(ORDER.refundedTheWrongAmount, "refunded"),
      order(ORDER.refundedWithNoPurchaseEntry, "refunded"),
      order(ORDER.failedAndNeverCharged, "failed"),
      order(ORDER.chargedTwiceTheSameAmount, "active"),
    ]);

    await database.insert(walletTransactions).values([
      // credit 10,000 − debit 3,000 − withdrawal 2,000 + refund 500 = 5,500
      entry(WALLET.ledgerAddsUp, "credit", 10_000),
      entry(WALLET.ledgerAddsUp, "debit", 3_000),
      entry(WALLET.ledgerAddsUp, "withdrawal", 2_000),
      entry(WALLET.ledgerAddsUp, "refund", 500),

      entry(WALLET.balanceAheadOfLedger, "credit", 4_000),

      // The known entries add up; the unknown one has no direction at all.
      entry(WALLET.unknownEntryType, "credit", 2_000),
      entry(WALLET.unknownEntryType, "unrecognized", 1),

      // Adds up to the balance, but the same reference was written twice.
      entry(WALLET.repeatedReference, "credit", 300, { reference: "integrity-twice" }),
      entry(WALLET.repeatedReference, "credit", 300, { reference: "integrity-twice" }),

      // The ledger agrees with the balance; the balance is simply below zero.
      entry(WALLET.negativeBalance, "debit", 500),

      entry(WALLET.twoDistinctEntries, "credit", 200),
      entry(WALLET.twoDistinctEntries, "credit", 100),

      entry(BUYER, "debit", 1_000, { orderId: ORDER.paidFor }),
      entry(BUYER, "debit", 900, { orderId: ORDER.chargedTheWrongAmount }),
      entry(BUYER, "debit", 1_000, { orderId: ORDER.refundedInFull }),
      entry(BUYER, "refund", 1_000, { orderId: ORDER.refundedInFull }),
      entry(BUYER, "debit", 1_000, { orderId: ORDER.refundedWithoutAnEntry }),
      entry(BUYER, "debit", 1_000, { orderId: ORDER.refundedTheWrongAmount }),
      entry(BUYER, "refund", 400, { orderId: ORDER.refundedTheWrongAmount }),
      entry(BUYER, "refund", 1_000, { orderId: ORDER.refundedWithNoPurchaseEntry }),
      entry(BUYER, "debit", 1_000, { orderId: ORDER.chargedTwiceTheSameAmount }),
      entry(BUYER, "debit", 1_000, { orderId: ORDER.chargedTwiceTheSameAmount }),
    ]);
  });
}

/** `count` more accounts and orders with nothing wrong with them. */
async function seedCleanRows(count: number, group: number) {
  await withoutTriggers(async () => {
    const ids = Array.from({ length: count }, (_, index) => uuid(group, index + 1));
    await database.insert(users).values(ids.map((id) => account(id, 1_000)));
    await database.insert(orders).values(ids.map((id, index) => order(uuid(group + 1, index + 1), "active", 1_000, id)));
    await database.insert(walletTransactions).values(
      ids.flatMap((id, index) => [
        entry(id, "credit", 2_000),
        entry(id, "debit", 1_000, { orderId: uuid(group + 1, index + 1) }),
      ]),
    );
  });
}

/** Statements that reached the database, as text. */
function statementsOf(spy: MockInstance<PGlite["query"]>): string[] {
  return spy.mock.calls.map((call) => String(call[0]));
}

const namedInLog = (prefix: string) =>
  errorLog.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).replace(/:$/, ""));

beforeAll(async () => {
  pg = new PGlite();
  const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema });
  integrity = await import("@/lib/payments/payment-integrity");
  route = await import("@/app/api/admin/integrity/route");
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  mocks.db = database;
  mocks.preview = false;
  mocks.admin.mockResolvedValue({ user: { id: "admin" }, response: null });
  errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await database.execute(sql`TRUNCATE TABLE wallet_transactions, orders, users CASCADE`);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the whole-database check agrees with the single-record checks", () => {
  it("counts exactly the accounts and orders built to fail", async () => {
    await seedMixedBooks();

    const summary = await integrity.runFullIntegrityCheck();

    expect(summary.orders).toEqual({ checked: 9, issues: ORDERS_WITH_ISSUES.length });
    expect(namedInLog("Order integrity issues for order ").sort()).toEqual(ORDERS_WITH_ISSUES);

    // The buyer's own verdict is not hand-computed here; the eight built
    // accounts are, and the log names every failing account.
    expect(summary.users.checked).toBe(9);
    const named = namedInLog("Wallet integrity issues for user ");
    expect(named.filter((id) => id !== BUYER).sort()).toEqual(WALLETS_WITH_ISSUES);
    expect(summary.users.issues).toBe(named.length);
  });

  it("reaches the same verdict as checkWalletIntegrity on every account", async () => {
    await seedMixedBooks();
    const every = await database.select({ id: users.id }).from(users);

    const failing: string[] = [];
    for (const { id } of every) {
      if (!(await integrity.checkWalletIntegrity(id)).valid) failing.push(id);
    }
    errorLog.mockClear();
    const summary = await integrity.runFullIntegrityCheck("wallet");

    expect(summary.users).toEqual({ checked: every.length, issues: failing.length });
    expect(namedInLog("Wallet integrity issues for user ").sort()).toEqual(failing.sort());
  });

  it("reaches the same verdict as checkOrderIntegrity on every order", async () => {
    await seedMixedBooks();
    const every = await database.select({ id: orders.id }).from(orders);

    const failing: string[] = [];
    for (const { id } of every) {
      if (!(await integrity.checkOrderIntegrity(id)).valid) failing.push(id);
    }
    errorLog.mockClear();
    const summary = await integrity.runFullIntegrityCheck("orders");

    expect(summary.orders).toEqual({ checked: every.length, issues: failing.length });
    expect(namedInLog("Order integrity issues for order ").sort()).toEqual(failing.sort());
  });

  it("says why, in the words the single-record checks use", async () => {
    await seedMixedBooks();

    await integrity.runFullIntegrityCheck();

    const reasons = (prefix: string, id: string) =>
      errorLog.mock.calls.find((call) => String(call[0]) === `${prefix}${id}:`)?.[1] as string[];

    expect(reasons("Wallet integrity issues for user ", WALLET.balanceAheadOfLedger)).toEqual([
      "Balance mismatch: recorded 4500, calculated 4000",
    ]);
    expect(reasons("Wallet integrity issues for user ", WALLET.negativeBalance)).toEqual([
      "Negative wallet balance detected",
    ]);
    expect(reasons("Wallet integrity issues for user ", WALLET.repeatedReference)).toEqual([
      "Duplicate transaction references detected",
    ]);
    expect(reasons("Wallet integrity issues for user ", WALLET.unknownEntryType)[0]).toMatch(/^Unknown transaction type/);

    expect(reasons("Order integrity issues for order ", ORDER.neverCharged)).toEqual(["No transaction found for order"]);
    expect(reasons("Order integrity issues for order ", ORDER.chargedTheWrongAmount)).toEqual([
      "Transaction amount mismatch: order 1000, transaction 900",
    ]);
    expect(reasons("Order integrity issues for order ", ORDER.refundedWithoutAnEntry)).toEqual([
      "Refunded order missing refund transaction",
    ]);
    expect(reasons("Order integrity issues for order ", ORDER.refundedTheWrongAmount)).toEqual([
      "Refund amount mismatch: order 1000, transaction 400",
    ]);
  });

  it("reports clean books as clean, and counts an account with no ledger at all", async () => {
    await seedCleanRows(5, 10);
    await withoutTriggers(async () => {
      await database.insert(users).values(account(uuid(12, 1), 0));
    });

    expect(await integrity.runFullIntegrityCheck()).toEqual({
      users: { checked: 6, issues: 0 },
      orders: { checked: 5, issues: 0 },
    });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("answers on an empty database", async () => {
    expect(await integrity.runFullIntegrityCheck()).toEqual({
      users: { checked: 0, issues: 0 },
      orders: { checked: 0, issues: 0 },
    });
  });
});

describe("the cost does not grow with the tables", () => {
  it("runs two statements on clean books, however many rows there are", async () => {
    await seedCleanRows(3, 20);
    const spy = vi.spyOn(pg, "query");
    await integrity.runFullIntegrityCheck();
    const small = spy.mock.calls.length;

    spy.mockClear();
    await seedCleanRows(120, 30);
    spy.mockClear();
    const summary = await integrity.runFullIntegrityCheck();

    expect(summary).toEqual({ users: { checked: 123, issues: 0 }, orders: { checked: 123, issues: 0 } });
    // It was 2 + 2 per account + 2 or 3 per order: about 500 here.
    expect(small).toBe(2);
    expect(spy.mock.calls.length).toBe(2);
  });

  it("adds one statement per kind when something is wrong, not one per failure", async () => {
    await seedMixedBooks();
    await seedCleanRows(40, 40);
    const spy = vi.spyOn(pg, "query");

    await integrity.runFullIntegrityCheck();

    expect(spy.mock.calls.length).toBe(4);
  });

  it("never loads the accounts or the orders themselves", async () => {
    await seedMixedBooks();
    const spy = vi.spyOn(pg, "query");

    await integrity.runFullIntegrityCheck();

    for (const statement of statementsOf(spy)) {
      // Password hashes and delivered codes used to be read for every row.
      expect(statement).not.toMatch(/password_hash|otp_code|esim_activation_code/);
      expect(statement).not.toMatch(/select\s+\*/i);
    }
  });

  it("names a bounded number of failures and counts the rest", async () => {
    await withoutTriggers(async () => {
      // Forty accounts holding a balance no ledger explains.
      await database.insert(users).values(Array.from({ length: 40 }, (_, index) => account(uuid(50, index + 1), 250)));
    });

    const summary = await integrity.runFullIntegrityCheck("wallet");

    expect(summary.users).toEqual({ checked: 40, issues: 40 });
    expect(namedInLog("Wallet integrity issues for user ")).toHaveLength(integrity.INTEGRITY_ISSUE_SAMPLE);
    const remainder = 40 - integrity.INTEGRITY_ISSUE_SAMPLE;
    expect(errorLog.mock.calls.map((call) => String(call[0]))).toContain(
      `Wallet integrity issues: ${remainder} more account(s) not listed`,
    );
    expect(errorLog).toHaveBeenCalledTimes(integrity.INTEGRITY_ISSUE_SAMPLE + 1);
  });
});

describe("the scope decides what is read", () => {
  it("does not touch the wallets when asked about orders", async () => {
    await seedMixedBooks();
    const spy = vi.spyOn(pg, "query");

    const summary = await integrity.runFullIntegrityCheck("orders");

    expect(summary.users).toEqual({ checked: 0, issues: 0 });
    expect(summary.orders.checked).toBe(9);
    for (const statement of statementsOf(spy)) expect(statement).not.toContain("wallet_balance");
  });

  it("does not touch the orders when asked about wallets", async () => {
    await seedMixedBooks();
    const spy = vi.spyOn(pg, "query");

    const summary = await integrity.runFullIntegrityCheck("wallet");

    expect(summary.orders).toEqual({ checked: 0, issues: 0 });
    expect(summary.users.checked).toBe(9);
    for (const statement of statementsOf(spy)) expect(statement).not.toMatch(/FROM orders/i);
  });

  it("is what the console's endpoint passes through", async () => {
    await seedMixedBooks();
    const get = (scope: string) => route.GET(new NextRequest(`https://pryva.test/api/admin/integrity?scope=${scope}`));

    const wallet = (await (await get("wallet")).json()) as { ok: boolean; scope: string; summary: Record<string, unknown> };
    expect(wallet).toMatchObject({ ok: true, scope: "wallet", summary: { orders: { checked: 0, issues: 0 } } });
    expect(wallet.summary.users).toMatchObject({ checked: 9 });

    const all = (await (await get("all")).json()) as { summary: { users: { checked: number }; orders: { checked: number; issues: number } } };
    expect(all.summary.orders).toEqual({ checked: 9, issues: ORDERS_WITH_ISSUES.length });
    expect(all.summary.users.checked).toBe(9);
  });

  it("refuses an unknown scope, and an unauthorised caller, before reading anything", async () => {
    const spy = vi.spyOn(pg, "query");

    const unknown = await route.GET(new NextRequest("https://pryva.test/api/admin/integrity?scope=everything"));
    expect(unknown.status).toBe(400);

    mocks.admin.mockResolvedValue({ user: null, response: Response.json({ error: "Forbidden" }, { status: 403 }) });
    const forbidden = await route.GET(new NextRequest("https://pryva.test/api/admin/integrity?scope=all"));
    expect(forbidden.status).toBe(403);

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("the in-memory preview", () => {
  it("still walks its handful of rows, and never sends SQL to a database that has none", async () => {
    const execute = vi.fn();
    mocks.preview = true;
    mocks.db = {
      execute,
      query: {
        users: {
          findMany: async () => [{ id: "preview-user" }],
          findFirst: async () => ({ walletBalance: 500 }),
        },
        orders: {
          findMany: async () => [{ id: "preview-order" }],
          findFirst: async () => ({ id: "preview-order", amount: 500, status: "active" }),
        },
        walletTransactions: {
          findMany: async () => [{ type: "credit", amount: 500, reference: "preview-credit" }],
          findFirst: async () => ({ amount: 500 }),
        },
      },
    };

    expect(await integrity.runFullIntegrityCheck()).toEqual({
      users: { checked: 1, issues: 0 },
      orders: { checked: 1, issues: 0 },
    });
    expect(await integrity.runFullIntegrityCheck("orders")).toEqual({
      users: { checked: 0, issues: 0 },
      orders: { checked: 1, issues: 0 },
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
