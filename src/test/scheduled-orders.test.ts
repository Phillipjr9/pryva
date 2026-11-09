import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

const mocks = vi.hoisted(() => ({ db: null as unknown, fulfill: vi.fn(), email: vi.fn() }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/email/schedule-wallet-emails", () => ({ scheduleWalletEmails: mocks.email }));
vi.mock("@/lib/services/fulfillment", async (original) => {
  const real = await original<typeof import("@/lib/services/fulfillment")>();
  return { ...real, fulfillPlan: mocks.fulfill };
});

let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let scheduled: typeof import("@/lib/services/scheduled-orders");
const USER = "11111111-1111-4111-8111-111111111111";

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "postgres://embedded-test/db");
  vi.stubEnv("VERCEL_ENV", "");
  pg = new PGlite();
  for (const file of (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
    await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  }
  database = drizzle(pg, { schema });
  mocks.db = database;
  scheduled = await import("@/lib/services/scheduled-orders");
  await database.insert(schema.users).values({ id: USER, name: "Customer", email: "schedule@example.test", passwordHash: "hash", walletBalance: 50000 });
}, 60000);
afterAll(async () => { vi.unstubAllEnvs(); await pg?.close(); });
beforeEach(async () => {
  vi.clearAllMocks();
  await database.delete(schema.walletTransactions);
  await database.delete(schema.scheduledOrders);
  await database.delete(schema.orders);
  await database.update(schema.users).set({ walletBalance: 50000, suspendedAt: null }).where(eq(schema.users.id, USER));
});

async function due(overrides: Partial<typeof schema.scheduledOrders.$inferInsert> = {}) {
  const [row] = await database.insert(schema.scheduledOrders).values({ userId: USER, service: "numbers", productSlug: "vn-ng", frequency: "daily", nextRunAt: new Date(Date.now() - 60000), ...overrides }).returning();
  return row;
}
const result = { provider: "bitcall", providerCostNgn: 900, providerRequestId: "activation-123", referenceCode: "+2348000000000", otpCode: null, expiresAt: new Date(Date.now() + 600000) };
type Hooks = { onOtpAttempt: () => Promise<void>; onOtpAccepted: (id: string) => Promise<void> };

describe("scheduled purchase safety", () => {
  it("claims before spending, stores the provider reference and charges once", async () => {
    const row = await due();
    mocks.fulfill.mockImplementationOnce(async (_plan: unknown, hooks: Hooks) => {
      const [run] = await database.select().from(schema.scheduledOrders).where(eq(schema.scheduledOrders.id, row.id));
      const [claim] = await database.select().from(schema.orders);
      expect(run).toMatchObject({ status: "processing", lastOrderId: claim.id });
      expect(claim.status).toBe("review");
      await hooks.onOtpAttempt();
      await hooks.onOtpAccepted(result.providerRequestId);
      expect((await database.select().from(schema.orders))[0].providerRequestId).toBe(result.providerRequestId);
      return result;
    });
    expect(await scheduled.processScheduledOrder(row)).toBe(true);
    const [order] = await database.select().from(schema.orders);
    const [run] = await database.select().from(schema.scheduledOrders);
    expect(order).toMatchObject({ status: "active", providerRequestId: result.providerRequestId });
    expect(run).toMatchObject({ status: "active", lastOrderId: order.id });
    expect(run.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(1);
    expect(await scheduled.processScheduledOrder(row)).toBe(false);
    expect(mocks.fulfill).toHaveBeenCalledOnce();
  });

  it("prevents an overlapping sweep from buying while the first is in flight", async () => {
    const row = await due();
    let started!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    mocks.fulfill.mockImplementationOnce(async (_plan: unknown, hooks: Hooks) => {
      await hooks.onOtpAttempt(); started(); await wait;
      throw new Error("lost response");
    });
    const first = scheduled.processScheduledOrder(row);
    await entered;
    expect(await scheduled.processScheduledOrder(row)).toBe(false);
    release();
    expect(await first).toBe(false);
    expect(mocks.fulfill).toHaveBeenCalledOnce();
    const [run] = await database.select().from(schema.scheduledOrders);
    expect(run.status).toBe("paused");
    expect((await database.select().from(schema.orders))[0].status).toBe("review");
    expect(await scheduled.resumeScheduledOrder(row.id, USER)).toBe(false);
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(0);
  });

  it("does not start a call if the account was suspended after the run was claimed", async () => {
    const row = await due();
    const buy = vi.fn();
    mocks.fulfill.mockImplementationOnce(async (_plan: unknown, hooks: Hooks) => {
      await database.update(schema.users).set({ suspendedAt: new Date() }).where(eq(schema.users.id, USER));
      await hooks.onOtpAttempt(); buy();
    });
    expect(await scheduled.processScheduledOrder(row)).toBe(false);
    expect(buy).not.toHaveBeenCalled();
    expect((await database.select().from(schema.orders))[0].status).toBe("cancelled");
    expect((await database.select().from(schema.scheduledOrders))[0].status).toBe("paused");
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(0);
  });

  it("holds an accepted order for review when its wallet debit cannot commit", async () => {
    const row = await due();
    mocks.fulfill.mockImplementationOnce(async (_plan: unknown, hooks: Hooks) => {
      await hooks.onOtpAttempt(); await hooks.onOtpAccepted(result.providerRequestId);
      await database.update(schema.users).set({ walletBalance: 0 }).where(eq(schema.users.id, USER));
      return result;
    });
    expect(await scheduled.processScheduledOrder(row)).toBe(false);
    const [order] = await database.select().from(schema.orders);
    expect(order).toMatchObject({ status: "review", providerRequestId: result.providerRequestId });
    expect((await database.select().from(schema.scheduledOrders))[0].status).toBe("paused");
    expect(await scheduled.resumeScheduledOrder(row.id, USER)).toBe(false);
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(0);
  });

  it("does not buy if the schedule is cancelled before its supplier boundary", async () => {
    const row = await due();
    const buy = vi.fn();
    mocks.fulfill.mockImplementationOnce(async (_plan: unknown, hooks: Hooks) => {
      expect(await scheduled.cancelScheduledOrder(row.id, USER)).toBe(true);
      await hooks.onOtpAttempt();
      buy();
    });
    expect(await scheduled.processScheduledOrder(row)).toBe(false);
    expect(buy).not.toHaveBeenCalled();
    expect((await database.select().from(schema.scheduledOrders))[0].status).toBe("cancelled");
    expect((await database.select().from(schema.orders))[0].status).toBe("cancelled");
  });

  it("preserves cancellation while recording a provider purchase already started", async () => {
    const row = await due();
    mocks.fulfill.mockImplementationOnce(async (_plan: unknown, hooks: Hooks) => {
      await hooks.onOtpAttempt();
      expect(await scheduled.cancelScheduledOrder(row.id, USER)).toBe(true);
      await hooks.onOtpAccepted(result.providerRequestId);
      return result;
    });
    expect(await scheduled.processScheduledOrder(row)).toBe(true);
    expect((await database.select().from(schema.scheduledOrders))[0].status).toBe("cancelled");
    expect((await database.select().from(schema.orders))[0].status).toBe("active");
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(1);
  });

  it("does not spend when the account lacks funds, the run is paused or not due", async () => {
    const row = await due();
    await database.update(schema.users).set({ walletBalance: 0 }).where(eq(schema.users.id, USER));
    expect(await scheduled.processScheduledOrder(row)).toBe(false);
    await database.update(schema.users).set({ walletBalance: 50000 }).where(eq(schema.users.id, USER));
    await database.update(schema.scheduledOrders).set({ status: "paused" }).where(eq(schema.scheduledOrders.id, row.id));
    expect(await scheduled.processScheduledOrder(row)).toBe(false);
    await database.update(schema.scheduledOrders).set({ status: "active", nextRunAt: new Date(Date.now() + 60000) }).where(eq(schema.scheduledOrders.id, row.id));
    expect(await scheduled.processScheduledOrder(row)).toBe(false);
    expect(mocks.fulfill).not.toHaveBeenCalled();
  });

  it("does not buy when the claim transaction fails", async () => {
    const row = await due();
    await pg.exec(`ALTER TABLE orders ADD CONSTRAINT reject_review_test CHECK (status <> 'review')`);
    try { await expect(scheduled.processScheduledOrder(row)).rejects.toThrow(); }
    finally { await pg.exec(`ALTER TABLE orders DROP CONSTRAINT reject_review_test`); }
    expect(mocks.fulfill).not.toHaveBeenCalled();
    expect((await database.select().from(schema.scheduledOrders))[0].status).toBe("active");
  });

  it("calculates frequency and clamps month-end", () => {
    expect(scheduled.calculateNextRun("daily", new Date("2024-01-01T00:00:00Z")).toISOString()).toBe("2024-01-02T00:00:00.000Z");
    expect(scheduled.calculateNextRun("monthly", new Date("2024-01-31T00:00:00Z")).toISOString()).toBe("2024-02-29T00:00:00.000Z");
    expect(() => scheduled.calculateNextRun("invalid" as never)).toThrow("Invalid frequency");
  });
});
