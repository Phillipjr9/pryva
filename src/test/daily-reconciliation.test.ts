import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  orders,
  paymentTopups,
  reconciliationRuns,
  TOPUP_STATUS,
  users,
  walletTransactions,
} from "@/db/schema";
import { completeTopUp } from "@/lib/topups";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
// The sweep skips the ledger check in the in-memory preview, so open it here to
// exercise the real SQL against PGlite.
vi.mock("@/lib/demo-policy", () => ({ isPreviewDatabase: () => false }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@/lib/schedule-wallet-emails", () => ({ scheduleWalletEmails: vi.fn() }));

let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let reconciliation: typeof import("@/lib/daily-reconciliation");

const USER = "6b1f2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";
const DAY = "2026-10-30";
/** 12:00 in Lagos on that day. */
const NOON = new Date("2026-10-30T11:00:00.000Z");

beforeAll(async () => {
  pg = new PGlite();
  const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema });
  mocks.db = database;
  reconciliation = await import("@/lib/daily-reconciliation");
});

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  await database.execute(sql`TRUNCATE TABLE reconciliation_runs, wallet_transactions, payment_topups, orders, gift_cards, withdrawals, users CASCADE`);
});

async function seedDay() {
  await database.insert(users).values({
    id: USER,
    name: "Recon Test",
    email: "recon@example.com",
    passwordHash: "x",
    walletBalance: 4000,
  });
  await database.insert(paymentTopups).values({
    reference: "TOP-1",
    userId: USER,
    amount: 5000,
    status: TOPUP_STATUS.completed,
    paidAt: NOON,
    createdAt: NOON,
  });
  await database.insert(walletTransactions).values([
    {
      userId: USER,
      type: "credit",
      amount: 5000,
      balanceAfter: 5000,
      description: "Wallet top-up",
      reference: "TOP-1",
      createdAt: NOON,
    },
    {
      userId: USER,
      type: "debit",
      amount: 1000,
      balanceAfter: 4000,
      description: "Order PRY-1",
      reference: "PRY-1",
      createdAt: new Date(NOON.getTime() + 60_000),
    },
  ]);
  await database.insert(orders).values({
    reference: "PRY-1",
    userId: USER,
    service: "numbers",
    productSlug: "sms-ng",
    productName: "Nigeria number",
    planLabel: "Single code",
    region: "Nigeria",
    duration: "15 minutes",
    amount: 1000,
    provider: "test",
    createdAt: new Date(NOON.getTime() + 60_000),
  });
}

describe("business day boundaries", () => {
  it("treats a Lagos day as a fixed 24 hours at UTC+1", () => {
    const { start, end } = reconciliation.lagosDayWindow(DAY);
    expect(start.toISOString()).toBe("2026-10-29T23:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-30T23:00:00.000Z");
  });

  it("puts 23:30 UTC on the following Lagos day", () => {
    expect(reconciliation.lagosDay(new Date("2026-10-30T23:30:00.000Z"))).toBe("2026-10-31");
    expect(reconciliation.lagosDay(new Date("2026-10-30T22:30:00.000Z"))).toBe("2026-10-30");
  });

  it("refuses a day that is not a date", () => {
    expect(() => reconciliation.lagosDayWindow("30-10-2026")).toThrow();
    expect(() => reconciliation.lagosDayWindow("2026-13-01")).toThrow();
  });
});

describe("the daily close", () => {
  it("adds up the day from the tables that recorded the money", async () => {
    await seedDay();
    const result = await reconciliation.runDailyReconciliation(DAY);

    expect(result.status).toBe("clean");
    expect(result.totals.topupsCompleted).toEqual({ count: 1, amount: 5000 });
    expect(result.totals.walletCredits).toEqual({ count: 1, amount: 5000 });
    expect(result.totals.walletDebits).toEqual({ count: 1, amount: 1000 });
    expect(result.totals.ordersPlaced).toEqual({ count: 1, amount: 1000 });
    expect(result.totals.netWalletMovement).toBe(4000);
    expect(result.accountsChecked).toBe(1);
    expect(result.discrepancies).toBe(0);
  });

  it("leaves the money tables alone", async () => {
    await seedDay();
    const before = await database.select().from(walletTransactions);
    await reconciliation.runDailyReconciliation(DAY);
    const after = await database.select().from(walletTransactions);
    expect(after).toEqual(before);
  });

  it("records the run, so 'we reconcile every day' is checkable", async () => {
    await seedDay();
    await reconciliation.runDailyReconciliation(DAY);
    const runs = await database.select().from(reconciliationRuns);
    expect(runs).toHaveLength(1);
    expect(runs[0].day).toBe(DAY);
    expect(runs[0].status).toBe("clean");
    expect(runs[0].finishedAt).toBeInstanceOf(Date);
    expect((runs[0].totals as { topupsCompleted: { amount: number } }).topupsCompleted.amount).toBe(5000);
  });

  it("re-running a day corrects its row instead of adding a second one", async () => {
    await seedDay();
    await reconciliation.runDailyReconciliation(DAY);
    await reconciliation.runDailyReconciliation(DAY);
    const runs = await database.select().from(reconciliationRuns);
    expect(runs).toHaveLength(1);
  });

  it("says 'attention' when a transaction's running balance is wrong", async () => {
    await seedDay();
    await database
      .update(walletTransactions)
      .set({ balanceAfter: 3999 })
      .where(eq(walletTransactions.reference, "PRY-1"));

    const result = await reconciliation.runDailyReconciliation(DAY);
    expect(result.status).toBe("attention");
    expect(result.discrepancies).toBeGreaterThan(0);
    expect(result.breaks.some((row) => row.kind === "balance_after")).toBe(true);
    // The day's totals are unaffected: the money moved, the arithmetic is wrong.
    expect(result.totals.walletDebits.amount).toBe(1000);
  });

  it("says 'attention' when the last ledger row disagrees with the balance column", async () => {
    await seedDay();
    await database.update(users).set({ walletBalance: 9_999 }).where(eq(users.id, USER));

    const result = await reconciliation.runDailyReconciliation(DAY);
    expect(result.status).toBe("attention");
    expect(result.breaks.some((row) => row.kind === "final_balance")).toBe(true);
    expect(result.breaks.find((row) => row.kind === "final_balance")?.detail).toContain("9999");
  });

  it("is clean on an empty database", async () => {
    const result = await reconciliation.runDailyReconciliation(DAY);
    expect(result.status).toBe("clean");
    expect(result.accountsChecked).toBe(0);
    expect(result.totals.topupsCompleted).toEqual({ count: 0, amount: 0 });
  });

  it("excludes money that belongs to the next Lagos day", async () => {
    await seedDay();
    await database.insert(paymentTopups).values({
      reference: "TOP-2",
      userId: USER,
      amount: 700,
      status: TOPUP_STATUS.completed,
      // 23:30 UTC on the 30th is 00:30 on the 31st in Lagos.
      paidAt: new Date("2026-10-30T23:30:00.000Z"),
      createdAt: new Date("2026-10-30T23:30:00.000Z"),
    });
    const result = await reconciliation.runDailyReconciliation(DAY);
    expect(result.totals.topupsCompleted).toEqual({ count: 1, amount: 5000 });

    const nextDay = await reconciliation.runDailyReconciliation("2026-10-31");
    expect(nextDay.totals.topupsCompleted).toEqual({ count: 1, amount: 700 });
  });

  it("counts a deposit that was credited by the app, not by the test", async () => {
    // Seeded the way the app seeds it — a pending row, then `completeTopUp`, the
    // only writer this column ever has — and the close runs on that day. A test
    // that inserts the word it later searches for proves nothing: this case sat
    // green for as long as the close looked for a status no code ever wrote.
    await database.insert(users).values({
      id: USER,
      name: "Recon Test",
      email: "recon@example.com",
      passwordHash: "x",
      walletBalance: 0,
    });
    await database.insert(paymentTopups).values({
      reference: "TOP-live",
      userId: USER,
      amount: 5000,
      status: TOPUP_STATUS.pending,
      createdAt: new Date(),
    });
    expect(await completeTopUp({ reference: "TOP-live", userId: USER, amount: 5000 })).toBe("credited");

    const result = await reconciliation.runDailyReconciliation(reconciliation.lagosDay());
    expect(result.totals.topupsCompleted).toEqual({ count: 1, amount: 5000 });
    expect(result.status).toBe("clean");
  });

  it("reads a payout row as money leaving, not as a break", async () => {
    await seedDay();
    // The withdraw route reserves its own fee and writes `withdrawal`. The close
    // classified anything that was not `debit` as a credit, so the balance going
    // down on a payout looked like broken arithmetic: every account that had ever
    // withdrawn money was reported as a ledger break, forever.
    await database.insert(walletTransactions).values({
      userId: USER,
      type: "withdrawal",
      amount: 1000,
      balanceAfter: 3000,
      description: "Payout WD-1",
      reference: "WD-1",
      createdAt: new Date(NOON.getTime() + 120_000),
    });
    await database.update(users).set({ walletBalance: 3000 }).where(eq(users.id, USER));

    const result = await reconciliation.runDailyReconciliation(DAY);
    expect(result.status).toBe("clean");
    expect(result.totals.walletWithdrawals).toEqual({ count: 1, amount: 1000 });
    // 5000 in, 1000 spent, 1000 paid out. The payout used to be missing from
    // this figure entirely, so it did not tie out to the day's ledger.
    expect(result.totals.netWalletMovement).toBe(3000);
  });

  it("flags a ledger type it cannot read instead of passing it", async () => {
    await seedDay();
    // A type in neither direction list has no arithmetic to check, so both
    // queries skip it. Reporting the account as clean would be the wrong kind of
    // quiet: it is a row the books cannot read, and the close has to say so.
    await database.insert(walletTransactions).values({
      userId: USER,
      type: "gift_redeem",
      amount: 500,
      balanceAfter: 4000,
      description: "Redeemed gift card",
      reference: "GFT-1",
      createdAt: new Date(NOON.getTime() + 120_000),
    });

    const result = await reconciliation.runDailyReconciliation(DAY);
    expect(result.status).toBe("attention");
    expect(result.breaks.map((row) => row.kind)).toEqual(["unknown_type"]);
    expect(result.breaks[0].detail).toContain("gift_redeem");

    // The run page lists final-balance breaks only, so the kind has to survive
    // into the row: "attention · 1" with an empty table is a dead end.
    const [run] = await database
      .select()
      .from(reconciliationRuns)
      .where(eq(reconciliationRuns.day, DAY));
    expect(run.notes).toContain("unknown_type");
  });

  it("lists the accounts behind a break, with their email", async () => {
    await seedDay();
    await database.update(users).set({ walletBalance: 1 }).where(eq(users.id, USER));
    const rows = await reconciliation.ledgerBreaks();
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("recon@example.com");
  });
});

/**
 * `amount` is an `integer` column, so `sum(amount)` comes back as a bigint and
 * `::int` asks Postgres to squeeze it back into int4. The ceiling is
 * 2,147,483,647 kobo -- ₦21,474,836.47 in a single Lagos day, and for the pending
 * withdrawal figure, across the whole backlog. Past it the nightly close does not
 * report a wrong number; it throws, and the day is left with no `reconciliation_runs`
 * row at all, which is the one thing an operator cannot tell apart from a quiet day.
 */
describe("a day too big for int4", () => {
  /** Fits in int4 on its own. Two of them do not. */
  const BIG = 2_000_000_000;

  it("closes a day whose deposits are bigger than the cast can hold", async () => {
    await database.insert(users).values({
      id: USER,
      name: "Big Day",
      email: "big@example.com",
      passwordHash: "x",
      walletBalance: BIG,
    });
    await database.insert(paymentTopups).values([
      { reference: "TOP-BIG-1", userId: USER, amount: BIG, status: "completed", paidAt: NOON, createdAt: NOON },
      { reference: "TOP-BIG-2", userId: USER, amount: BIG, status: "completed", paidAt: NOON, createdAt: NOON },
    ]);

    const result = await reconciliation.runDailyReconciliation(DAY);

    // int8 arrives from the driver as a string and `sql<number>` is only an
    // assertion, so this equality is also the check that the close converted it.
    expect(result.totals.topupsCompleted).toEqual({ count: 2, amount: 4_000_000_000 });

    const [run] = await database.select().from(reconciliationRuns);
    expect((run.totals as { topupsCompleted: { amount: number } }).topupsCompleted.amount).toBe(4_000_000_000);
  });

  it("adds up a day of ledger credits grouped by type without the ceiling", async () => {
    // Two accounts, one deposit each. A single account cannot hold more than an
    // int4 balance, so the only way a day crosses the ceiling is by being busy
    // -- which is exactly the figure this query exists to produce.
    const SECOND = "1c9e7a5b-3d4f-4a6b-8c9d-2e1f2a3b4c7a";
    await database.insert(users).values([
      { id: USER, name: "Big Ledger", email: "bigledger@example.com", passwordHash: "x", walletBalance: BIG },
      { id: SECOND, name: "Big Ledger 2", email: "bigledger2@example.com", passwordHash: "x", walletBalance: BIG },
    ]);
    await database.insert(walletTransactions).values([
      {
        userId: USER,
        type: "credit",
        amount: BIG,
        balanceAfter: BIG,
        description: "Deposit 1",
        reference: "B-1",
        createdAt: NOON,
      },
      {
        userId: SECOND,
        type: "credit",
        amount: BIG,
        balanceAfter: BIG,
        description: "Deposit 2",
        reference: "B-2",
        createdAt: new Date(NOON.getTime() + 60_000),
      },
    ]);

    const result = await reconciliation.runDailyReconciliation(DAY);

    expect(result.totals.walletCredits).toEqual({ count: 2, amount: 4_000_000_000 });
    expect(result.status).toBe("clean");
  });
});

describe("the nightly job", () => {
  const route = readFileSync("src/app/api/cron/nightly/route.ts", "utf8");
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    crons: Array<{ path: string; schedule: string }>;
  };

  it("is scheduled, and runs after midnight in Lagos", () => {
    const cron = vercel.crons.find((entry) => entry.path === "/api/cron/nightly");
    expect(cron).toBeDefined();
    // 01:20 UTC is 02:20 in Lagos: the previous day has closed on both sides.
    expect(cron?.schedule).toBe("20 1 * * *");
  });

  it("requires the cron secret and fails closed without it", () => {
    expect(route).toContain("CRON_SECRET");
    expect(route).toContain("Bearer");
    expect(route).toContain("status: 401");
  });

  it("closes yesterday by default, and can backfill one day", () => {
    expect(route).toContain("lagosDay(new Date(Date.now() - 24 * 60 * 60 * 1000))");
    expect(route).toContain("searchParams.get(\"day\")");
    expect(route).toContain("day must be YYYY-MM-DD");
    expect(route.includes("\\d{4}")).toBe(true);
  });

  it("reports the result without leaking account ids into a log line", () => {
    // The nightly response carries counts, not the accounts behind them: an
    // account id in a cron log is data sitting in a place nobody audits.
    expect(route).toContain("result.discrepancies");
    expect(route).toContain("result.accountsChecked");
    expect(route).not.toContain("result.breaks");
  });
});
