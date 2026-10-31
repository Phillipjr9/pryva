import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { orders, paymentTopups, reconciliationRuns, users, walletTransactions } from "@/db/schema";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
// The sweep skips the ledger check in the in-memory preview, so open it here to
// exercise the real SQL against PGlite.
vi.mock("@/lib/demo-policy", () => ({ isPreviewDatabase: () => false }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

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
    status: "paid",
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
    expect(result.totals.topupsPaid).toEqual({ count: 1, amount: 5000 });
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
    expect((runs[0].totals as { topupsPaid: { amount: number } }).topupsPaid.amount).toBe(5000);
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
    expect(result.totals.topupsPaid).toEqual({ count: 0, amount: 0 });
  });

  it("excludes money that belongs to the next Lagos day", async () => {
    await seedDay();
    await database.insert(paymentTopups).values({
      reference: "TOP-2",
      userId: USER,
      amount: 700,
      status: "paid",
      // 23:30 UTC on the 30th is 00:30 on the 31st in Lagos.
      paidAt: new Date("2026-10-30T23:30:00.000Z"),
      createdAt: new Date("2026-10-30T23:30:00.000Z"),
    });
    const result = await reconciliation.runDailyReconciliation(DAY);
    expect(result.totals.topupsPaid).toEqual({ count: 1, amount: 5000 });

    const nextDay = await reconciliation.runDailyReconciliation("2026-10-31");
    expect(nextDay.totals.topupsPaid).toEqual({ count: 1, amount: 700 });
  });

  it("lists the accounts behind a break, with their email", async () => {
    await seedDay();
    await database.update(users).set({ walletBalance: 1 }).where(eq(users.id, USER));
    const rows = await reconciliation.ledgerBreaks();
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("recon@example.com");
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
