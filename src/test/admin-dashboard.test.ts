import { readdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { orders, users, withdrawals, supportTickets, fraudEvents, contactMessages } from "@/db/schema";
import { parseReportPeriod, percentChange, reportWindow, revenueSeries, serviceRevenue } from "@/lib/admin/dashboard";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));

let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
const NOW = new Date("2026-11-06T18:00:00.000Z");
const CUSTOMER = "11111111-1111-4111-8111-111111111111";

beforeAll(async () => {
  pg = new PGlite();
  const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema });
  mocks.db = database;
});
afterAll(async () => { await pg?.close(); });

describe("dashboard reporting windows", () => {
  it("uses UTC calendar days and an equal previous period", () => {
    const window = reportWindow(7, NOW);
    expect(window.end.toISOString()).toBe("2026-11-07T00:00:00.000Z");
    expect(window.start.toISOString()).toBe("2026-10-31T00:00:00.000Z");
    expect(window.previousStart.toISOString()).toBe("2026-10-24T00:00:00.000Z");
    expect(window.end.getTime() - window.start.getTime()).toBe(window.start.getTime() - window.previousStart.getTime());
  });
  it("rejects unsupported periods instead of accepting arbitrary query input", () => {
    expect(parseReportPeriod("7")).toBe(7);
    expect(parseReportPeriod("36500")).toBe(30);
    expect(parseReportPeriod(undefined)).toBe(30);
  });
  it("does not invent a percentage when the previous period is zero", () => {
    expect(percentChange(100, 0)).toBeNull();
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
  });
});

describe("chart and service aggregation", () => {
  const window = reportWindow(7, NOW);
  it("fills empty days with zero and excludes undelivered or out-of-window orders", () => {
    const series = revenueSeries([
      { createdAt: "2026-11-01T10:00:00Z", amount: 1000, status: "delivered" },
      { createdAt: "2026-11-01T12:00:00Z", amount: 500, status: "delivered" },
      { createdAt: "2026-11-02T10:00:00Z", amount: 9000, status: "failed" },
      { createdAt: "2026-10-01T10:00:00Z", amount: 9000, status: "delivered" },
    ], window);
    expect(series).toHaveLength(7);
    expect(series.find((point) => point.day === "2026-11-01")).toEqual({ day: "2026-11-01", revenue: 1500, orders: 2 });
    expect(series.reduce((sum, point) => sum + point.revenue, 0)).toBe(1500);
  });
  it("groups delivered revenue by service, largest first", () => {
    expect(serviceRevenue([
      { service: "esim", amount: 1000, status: "delivered" },
      { service: "proxy", amount: 3000, status: "delivered" },
      { service: "esim", amount: 500, status: "delivered" },
      { service: "esim", amount: 9000, status: "refunded" },
    ])).toEqual([
      { service: "proxy", revenue: 3000, orders: 1 },
      { service: "esim", revenue: 1500, orders: 2 },
    ]);
  });
});

describe("dashboard database reads", () => {
  beforeAll(async () => {
    await database.execute(sql`TRUNCATE TABLE users CASCADE`);
    await database.insert(users).values([
      { id: CUSTOMER, name: "Dashboard Customer", email: "dashboard-customer@example.test", passwordHash: "x", createdAt: new Date("2026-10-20T10:00:00Z"), emailVerifiedAt: new Date("2026-10-20T10:00:00Z") },
      { name: "Previous Customer", email: "dashboard-previous@example.test", passwordHash: "x", createdAt: new Date("2026-09-20T10:00:00Z") },
    ]);
    const order = (reference: string, amount: number, status: string, createdAt: string, service = "esim") => ({
      reference, userId: CUSTOMER, service, productSlug: "test-plan", productName: "Test plan", planLabel: "1 GB", region: "NG", duration: "30 days", amount, status, provider: "test", createdAt: new Date(createdAt),
    });
    await database.insert(orders).values([
      order("DASH-CURRENT-1", 5000, "delivered", "2026-10-20T10:00:00Z"),
      order("DASH-CURRENT-2", 2500, "delivered", "2026-11-06T10:00:00Z", "proxy"),
      order("DASH-CURRENT-FAILED", 9000, "failed", "2026-11-05T10:00:00Z"),
      order("DASH-PREVIOUS", 4000, "delivered", "2026-09-20T10:00:00Z"),
      order("DASH-OUTSIDE", 100000, "delivered", "2026-08-01T10:00:00Z"),
    ] as never);
    await database.insert(withdrawals).values({ userId: CUSTOMER, amount: 3000, fee: 0, bankName: "Test Bank", accountNumber: "0000000000", accountName: "Dashboard Customer", reference: "DASH-PAYOUT", status: "pending" });
    await database.insert(supportTickets).values({ userId: CUSTOMER, subject: "Needs a person", status: "escalated" });
    await database.insert(fraudEvents).values({ userId: CUSTOMER, kind: "withdrawal_review", reasons: "test", severity: "warn" });
    await database.insert(contactMessages).values({ name: "Visitor", email: "visitor@example.test", topic: "Question", message: "Hello", status: "open" });
  });

  it("reports real period totals, comparisons and queues without leaking credentials", async () => {
    const { getDashboardData } = await import("@/lib/admin/dashboard");
    const data = await getDashboardData(30, NOW);
    expect(data.revenue).toBe(7500);
    expect(data.totalOrders).toBe(3);
    expect(data.revenueChange).toBe(87.5);
    expect(data.ordersChange).toBe(200);
    expect(data.totalCustomers).toBe(2);
    expect(data.newCustomers).toBe(1);
    expect(data.pendingPayoutCount).toBe(1);
    expect(data.pendingPayoutAmount).toBe(3000);
    expect(data.escalatedTickets).toBe(1);
    expect(data.openRiskSignals).toBe(1);
    expect(data.openMessages).toBe(1);
    expect(data.chart).toHaveLength(30);
    expect(data.chart.reduce((sum, point) => sum + point.revenue, 0)).toBe(7500);
    expect(data.services[0]).toEqual({ service: "esim", revenue: 5000, orders: 1 });
    expect(data.recentOrders[0]?.reference).toBe("DASH-CURRENT-2");
    expect(data.recentOrders[0]).not.toHaveProperty("esimActivationCode");
    expect(data.recentOrders[0]).not.toHaveProperty("providerCostNgn");
  });
});
