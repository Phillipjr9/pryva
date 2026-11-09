import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";

const mocks = vi.hoisted(() => ({ db: null as unknown, fulfill: vi.fn(), authenticated: true, sameOrigin: true }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/identity/admin-auth", () => ({ authorizeAdminApi: async () => ({ user: { id: "22222222-2222-4222-8222-222222222222", email: "admin@example.test" }, response: null }) }));
vi.mock("@/lib/identity/auth", () => ({ requireAuthApi: async () => mocks.authenticated ? { id: "11111111-1111-4111-8111-111111111111" } : null }));
vi.mock("@/lib/platform/net", () => ({ isSameOriginMutation: () => mocks.sameOrigin }));
vi.mock("@/lib/platform/rate-limit", async (original) => ({ ...await original<typeof import("@/lib/platform/rate-limit")>(), purchaseRateLimiter: async () => ({ allowed: true }) }));
vi.mock("@/lib/admin/fraud", () => ({ purchaseVelocity: async () => ({ allowed: true }), recordFraudEvent: vi.fn() }));
vi.mock("@/lib/email/schedule-wallet-emails", () => ({ scheduleWalletEmails: vi.fn() }));
vi.mock("@/lib/content/referrals", () => ({ settleReferralRewards: async () => ({ credited: 0 }) }));
vi.mock("@/lib/services/numbers/number-availability", () => ({ isNumberPlanOrderingConfigured: () => true }));
vi.mock("@/lib/services/fulfillment", async (original) => ({ ...await original<typeof import("@/lib/services/fulfillment")>(), fulfillPlan: mocks.fulfill }));
const USER = "11111111-1111-4111-8111-111111111111";
let pg: PGlite, database: PgliteDatabase<typeof schema>, POST: typeof import("@/app/api/orders/bulk/route").POST;
let refundUnattempted: typeof import("@/app/api/admin/bulk-unattempted/route").POST;
const body = (requestId: string, quantity = 2) => ({ requestId, items: [{ productSlug: "vn-ng", quantity }] });
const request = (value: unknown) => new Request("https://pryva.test/api/orders/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
const delivery = { provider: "bitcall", providerRequestId: "provider-123", providerCostNgn: 100, referenceCode: "+123456789", otpCode: null, expiresAt: new Date(Date.now() + 600000) };
beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "postgres://embedded-test/db"); vi.stubEnv("VERCEL_ENV", "");
  pg = new PGlite();
  for (const file of (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema }); mocks.db = database;
  ({ POST } = await import("@/app/api/orders/bulk/route"));
  ({ POST: refundUnattempted } = await import("@/app/api/admin/bulk-unattempted/route"));
}, 60000);
afterAll(async () => { await pg?.close(); vi.unstubAllEnvs(); });
beforeEach(async () => {
  await pg.exec('TRUNCATE TABLE "users" CASCADE');
  await database.insert(schema.users).values([
    { id: USER, name: "Buyer", email: "bulk@example.test", passwordHash: "x", walletBalance: 100000 },
    { id: "22222222-2222-4222-8222-222222222222", name: "Admin", email: "admin@example.test", passwordHash: "x", walletBalance: 0 },
  ]);
  mocks.authenticated = true; mocks.sameOrigin = true; mocks.fulfill.mockReset();
  mocks.fulfill.mockImplementation(async (_plan, hooks) => { await hooks.onOtpAttempt(); await hooks.onOtpAccepted(delivery.providerRequestId); return delivery; });
});
async function rows() { return database.select().from(schema.orders); }
async function ledger() { return database.select().from(schema.walletTransactions); }
async function balance() { return (await database.select().from(schema.users).where(eq(schema.users.id, USER)))[0].walletBalance; }

describe("durable bulk checkout", () => {
  it("creates individually linked debits and replays without spending twice", async () => {
    const input = body(randomUUID());
    const first = await POST(request(input));
    expect(first.status).toBe(200);
    const data = await first.json();
    expect(data.units).toHaveLength(2);
    expect(data.units.every((unit: { status: string }) => unit.status === "active")).toBe(true);
    const entries = await ledger();
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.type === "debit" && entry.orderId)).toBe(true);
    expect(entries.reduce((sum, entry) => sum + entry.amount, 0)).toBe(data.batch.total);
    expect(await balance()).toBe(100000 - data.batch.total);
    const replay = await POST(request(input));
    expect((await replay.json()).replayed).toBe(true);
    expect(mocks.fulfill).toHaveBeenCalledTimes(2);
    expect(await ledger()).toHaveLength(2);
    expect((await POST(request(body(input.requestId, 3)))).status).toBe(409);
  });
  it("allocates the discounted total across every unit and checks the discounted margin", async () => {
    const response = await POST(request(body(randomUUID(), 10)));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.units).toHaveLength(10);
    expect((await ledger()).reduce((sum, entry) => sum + entry.amount, 0)).toBe(data.batch.total);
    expect(mocks.fulfill.mock.calls.map((call) => call[0].price).reduce((sum, price) => sum + price, 0)).toBe(data.batch.total);
  });
  it("rolls back the entire batch when the wallet cannot cover all units", async () => {
    await database.update(schema.users).set({ walletBalance: 1 }).where(eq(schema.users.id, USER));
    expect((await POST(request(body(randomUUID())))).status).toBe(402);
    expect(await rows()).toHaveLength(0);
    expect(await ledger()).toHaveLength(0);
    expect(await database.select().from(schema.bulkBatches)).toHaveLength(0);
    expect(mocks.fulfill).not.toHaveBeenCalled();
  });

  it("holds an ambiguous supplier call and refunds only unattempted units", async () => {
    mocks.fulfill.mockImplementation(async (_plan, hooks) => { await hooks.onOtpAttempt(); throw new Error("lost supplier response"); });
    const input = body(randomUUID(), 3);
    const response = await POST(request(input));
    expect(response.status).toBe(202);
    const orders = await rows();
    expect(orders.filter((order) => order.status === "review")).toHaveLength(1);
    expect(orders.filter((order) => order.status === "refunded")).toHaveLength(2);
    expect((await ledger()).filter((entry) => entry.type === "refund")).toHaveLength(2);
    expect(mocks.fulfill).toHaveBeenCalledTimes(1);
    expect((await POST(request(input))).status).toBe(202);
    expect((await POST(request(body(randomUUID())))).status).toBe(202);
    expect(mocks.fulfill).toHaveBeenCalledTimes(1);
  });
  it("closes a reviewed batch only after all units have been settled", async () => {
    mocks.fulfill.mockImplementation(async (_plan, hooks) => { await hooks.onOtpAttempt(); throw new Error("unknown"); });
    const input = body(randomUUID());
    expect((await POST(request(input))).status).toBe(202);
    const held = (await rows()).find((order) => order.status === "review")!;
    // Simulate a separate operator reconciliation; the replay itself never
    // decides whether the upstream order was delivered or refunds money.
    await database.update(schema.orders).set({ status: "active", providerRequestId: "confirmed" }).where(eq(schema.orders.id, held.id));
    expect((await POST(request(input))).status).toBe(200);
    expect((await database.select().from(schema.bulkBatches))[0].status).toBe("completed");
    expect((await ledger()).filter((entry) => entry.type === "refund")).toHaveLength(1);
  });

  it("refunds every unit if supplier preflight fails before the call", async () => {
    mocks.fulfill.mockRejectedValue(new Error("unavailable before purchase"));
    const response = await POST(request(body(randomUUID())));
    expect(response.status).toBe(200);
    expect((await rows()).every((order) => order.status === "refunded")).toBe(true);
    expect(await balance()).toBe(100000);
    expect((await ledger()).filter((entry) => entry.type === "refund")).toHaveLength(2);
  });
  it("preserves restricted referral credit through per-unit refunds", async () => {
    await database.execute(sql`UPDATE users SET referral_credit_balance = 1200 WHERE id = ${USER}`);
    mocks.fulfill.mockRejectedValue(new Error("preflight unavailable"));
    expect((await POST(request(body(randomUUID())))).status).toBe(200);
    const state = await pg.query<{ wallet_balance: number; referral_credit_balance: number }>("SELECT wallet_balance, referral_credit_balance FROM users WHERE id = $1", [USER]);
    expect(state.rows[0]).toEqual({ wallet_balance: 100000, referral_credit_balance: 1200 });
    const entries = await ledger();
    expect(entries.filter((entry) => entry.type === "debit")).toHaveLength(2);
    expect(entries.filter((entry) => entry.type === "refund")).toHaveLength(2);
  });

  it("never contacts the provider if suspension wins after reservation", async () => {
    mocks.fulfill.mockImplementation(async (_plan, hooks) => {
      await database.update(schema.users).set({ suspendedAt: new Date() }).where(eq(schema.users.id, USER));
      await hooks.onOtpAttempt(); throw new Error("should not reach provider");
    });
    expect((await POST(request(body(randomUUID())))).status).toBe(200);
    expect((await rows()).every((order) => order.status === "refunded")).toBe(true);
    expect(await balance()).toBe(100000);
    expect(mocks.fulfill).toHaveBeenCalledOnce();
  });
  it("replays while a first unit is in flight rather than starting another batch", async () => {
    let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    mocks.fulfill.mockImplementationOnce(async (_plan, hooks) => { await hooks.onOtpAttempt(); entered(); await waiting; await hooks.onOtpAccepted(delivery.providerRequestId); return delivery; });
    const input = body(randomUUID());
    const first = POST(request(input)); await started;
    expect((await POST(request(input))).status).toBe(202);
    expect((await POST(request(body(randomUUID())))).status).toBe(202);
    expect(mocks.fulfill).toHaveBeenCalledTimes(1);
    release(); expect((await first).status).toBe(200);
    expect(mocks.fulfill).toHaveBeenCalledTimes(2);
  });
  it("atomically refunds a provably unattempted unit before its paid boundary", async () => {
    let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let paidCalls = 0;
    mocks.fulfill.mockImplementationOnce(async (_plan, hooks) => { entered(); await waiting; await hooks.onOtpAttempt(); paidCalls++; return delivery; });
    const input = body(randomUUID(), 1);
    const first = POST(request(input)); await started;
    const unit = (await rows())[0];
    const adminRequest = () => new NextRequest("https://pryva.test/api/admin/bulk-unattempted", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId: unit.id, reason: "Investigated interrupted batch" }) });
    expect((await refundUnattempted(adminRequest())).status).toBe(200);
    expect((await refundUnattempted(adminRequest())).status).toBe(409);
    release(); await first;
    expect(paidCalls).toBe(0);
    expect((await rows())[0].status).toBe("refunded");
    expect(await balance()).toBe(100000);
    expect((await ledger()).filter((entry) => entry.type === "refund")).toHaveLength(1);
    expect(await database.select().from(schema.adminAuditLog)).toHaveLength(1);
  });
  it("rolls back an unattempted refund if its audit entry fails", async () => {
    let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    mocks.fulfill.mockImplementationOnce(async (_plan, hooks) => { entered(); await waiting; await hooks.onOtpAttempt(); return delivery; });
    const first = POST(request(body(randomUUID(), 1))); await started;
    const unit = (await rows())[0];
    await pg.exec("ALTER TABLE admin_audit_log ADD CONSTRAINT reject_bulk_audit CHECK (action <> 'order.refund')");
    try {
      const result = await refundUnattempted(new NextRequest("https://pryva.test/api/admin/bulk-unattempted", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId: unit.id, reason: "Investigated interrupted batch" }) }));
      expect(result.status).toBe(500);
      expect((await rows())[0].status).toBe("processing");
      expect((await ledger()).filter((entry) => entry.type === "refund")).toHaveLength(0);
    } finally { await pg.exec("ALTER TABLE admin_audit_log DROP CONSTRAINT reject_bulk_audit"); release(); await first; }
  });

  it("refuses to refund when the paid supplier boundary has started", async () => {
    let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    mocks.fulfill.mockImplementationOnce(async (_plan, hooks) => { await hooks.onOtpAttempt(); entered(); await waiting; return delivery; });
    const first = POST(request(body(randomUUID(), 1))); await started;
    const unit = (await rows())[0];
    const result = await refundUnattempted(new NextRequest("https://pryva.test/api/admin/bulk-unattempted", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId: unit.id, reason: "Investigated interrupted batch" }) }));
    expect(result.status).toBe(409);
    expect((await ledger()).filter((entry) => entry.type === "refund")).toHaveLength(0);
    release(); await first;
  });

  it("rejects anonymous, cross-origin and invalid batches without a debit", async () => {
    mocks.authenticated = false; expect((await POST(request(body(randomUUID())))).status).toBe(401);
    mocks.authenticated = true; mocks.sameOrigin = false; expect((await POST(request(body(randomUUID())))).status).toBe(403);
    mocks.sameOrigin = true; expect((await POST(request(body(randomUUID(), 21)))).status).toBe(400);
    expect(await ledger()).toHaveLength(0);
  });
});
