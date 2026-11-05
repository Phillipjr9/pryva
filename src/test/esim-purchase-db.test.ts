import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

/** Actual embedded PostgreSQL: no production records or supplier calls. */
const mocks = vi.hoisted(() => ({
  db: null as unknown,
  recheck: vi.fn(),
  purchase: vi.fn(),
}));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/identity/auth", () => ({ getCurrentUser: async () => ({ id: "11111111-1111-4111-8111-111111111111", walletBalance: 50_000 }) }));
vi.mock("@/lib/platform/demo-policy", () => ({ isPreviewDatabase: () => false }));
vi.mock("@/lib/platform/net", () => ({ isSameOriginMutation: () => true }));
vi.mock("@/lib/platform/rate-limit", () => ({ purchaseRateLimiter: async () => ({ allowed: true }) }));
vi.mock("@/lib/admin/fraud", () => ({ purchaseVelocity: async () => ({ allowed: true }), recordFraudEvent: vi.fn() }));
vi.mock("@/lib/services/esim/esim-catalog", () => ({ findEsimOffer: async () => offer(), recheckEsimOffer: mocks.recheck, esimOfferTerms: () => "a".repeat(24) }));
vi.mock("@/lib/services/esim/esim-fulfilment", () => ({ purchaseEsim: mocks.purchase }));
vi.mock("@/lib/email/schedule-wallet-emails", () => ({ scheduleWalletEmails: vi.fn() }));
vi.mock("@/lib/content/referrals", () => ({ settleReferralRewards: async () => ({ credited: 0 }) }));
vi.mock("@/lib/identity/admin-auth", () => ({ authorizeAdminApi: async () => ({ user: { id: "admin" }, response: null }) }));
vi.mock("@/lib/admin/admin-audit", () => ({ recordAdminAction: async () => undefined }));
vi.mock("@/lib/services/reconciliation", () => ({ flagReconciliation: async () => undefined }));

const USER = "11111111-1111-4111-8111-111111111111";
let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let purchase: typeof import("@/app/api/esim/purchase/route").POST;
let refund: typeof import("@/app/api/admin/refunds/route").POST;

function offer() {
  return {
    id: "live-esim-0123456789abcdef0123", planId: "pln_private", name: "Nigeria 1GB",
    region: "Nigeria", countries: ["NG"], dataLabel: "1GB of data", validityLabel: "7 days",
    coverage: "catalog-country", costNgn: 7_200, priceNgn: 9_800, purchasable: true,
  };
}
function delivered() {
  return { kind: "delivered", delivery: {
    provider: "bitcall", providerRequestId: "ord_provider", iccid: "8944000000000000001",
    activationCode: "LPA:1$rsp.example$ABC", installUrl: null,
  } };
}
function request(requestId: string) {
  return new NextRequest("https://pryva.test/api/esim/purchase", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ offerId: offer().id, requestId, expectedPriceNgn: 9_800, expectedTerms: "a".repeat(24) }),
  });
}
function refundRequest(orderId: string, reconciliationConfirmed = false) {
  return new NextRequest("https://pryva.test/api/admin/refunds", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId, reconciliationConfirmed, reason: "Checking an eSIM order" }),
  });
}
async function balance() {
  const [user] = await database.select({ walletBalance: schema.users.walletBalance }).from(schema.users).where(eq(schema.users.id, USER));
  return user.walletBalance;
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "postgres://embedded-test/db");
  vi.stubEnv("VERCEL_ENV", "");
  pg = new PGlite();
  const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema });
  mocks.db = database;
  ({ POST: purchase } = await import("@/app/api/esim/purchase/route"));
  ({ POST: refund } = await import("@/app/api/admin/refunds/route"));
}, 30_000);

afterAll(async () => { await pg?.close(); vi.unstubAllEnvs(); });

beforeEach(async () => {
  vi.clearAllMocks();
  await pg.exec('TRUNCATE TABLE "users" CASCADE');
  await database.insert(schema.users).values({
    id: USER, name: "Buyer", email: "buyer@example.com", passwordHash: "hash", walletBalance: 50_000,
  });
  mocks.recheck.mockResolvedValue(offer());
  mocks.purchase.mockResolvedValue(delivered());
});

describe("eSIM purchase with the real unique index and wallet transaction", () => {
  it("commits one delivery and one debit, and replays the same request", async () => {
    const requestId = randomUUID();
    expect((await purchase(request(requestId))).status).toBe(200);
    const replay = await (await purchase(request(requestId))).json();
    expect(replay.replayed).toBe(true);
    expect(mocks.purchase).toHaveBeenCalledTimes(1);
    const rows = await database.select().from(schema.orders);
    const entries = await database.select().from(schema.walletTransactions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "active", amount: 9_800, providerRequestId: "ord_provider", esimActivationCode: "LPA:1$rsp.example$ABC" });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ orderId: rows[0].id, type: "debit", amount: 9_800 });
    expect(await balance()).toBe(40_200);
    expect(JSON.stringify(replay)).not.toMatch(/pln_private|bitcall|7200/);
  });

  it("pre-claims simultaneous submissions before the provider can be called twice", async () => {
    let releaseQuote!: () => void;
    let releasePurchase!: () => void;
    const quoteWait = new Promise<void>((resolve) => { releaseQuote = resolve; });
    const purchaseWait = new Promise<void>((resolve) => { releasePurchase = resolve; });
    mocks.recheck.mockImplementation(async () => { await quoteWait; return offer(); });
    mocks.purchase.mockImplementation(async () => { await purchaseWait; return delivered(); });
    const requestId = randomUUID();
    const first = purchase(request(requestId));
    const second = purchase(request(requestId));
    await vi.waitFor(() => expect(mocks.recheck).toHaveBeenCalledTimes(2));
    releaseQuote();
    await vi.waitFor(() => expect(mocks.purchase).toHaveBeenCalledTimes(1));
    const replay = await Promise.race([first, second]);
    expect((await replay.json()).replayed).toBe(true);
    releasePurchase();
    await Promise.all([first, second]);
    expect(mocks.purchase).toHaveBeenCalledTimes(1);
    expect(await database.select().from(schema.orders)).toHaveLength(1);
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(1);
    expect(await balance()).toBe(40_200);
  });

  it("persists an accepted provider reference before waiting for delivery", async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    let accepted = false;
    mocks.purchase.mockImplementation(async (_offer, onAccepted: (id: string) => Promise<void>) => {
      await onAccepted("ord_provider_accepted");
      accepted = true;
      await wait;
      return { kind: "pending", providerRequestId: "ord_provider_accepted" };
    });
    const pending = purchase(request(randomUUID()));
    await vi.waitFor(() => expect(accepted).toBe(true));
    const [before] = await database.select().from(schema.orders);
    expect(before).toMatchObject({ status: "review", providerRequestId: "ord_provider_accepted" });
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(0);
    release();
    expect((await pending).status).toBe(202);
    const [after] = await database.select().from(schema.orders);
    expect(after).toMatchObject({ status: "processing", providerRequestId: "ord_provider_accepted" });
    expect(await balance()).toBe(50_000);
  });

  it("rolls back activation and leaves a recoverable uncharged review when the wallet changed", async () => {
    // The signed-in balance can be stale after another purchase.
    await database.update(schema.users).set({ walletBalance: 1_000 }).where(eq(schema.users.id, USER));
    const response = await purchase(request(randomUUID()));
    expect(response.status).toBe(409);
    const [order] = await database.select().from(schema.orders);
    expect(order).toMatchObject({ status: "review", providerRequestId: "ord_provider", esimActivationCode: null });
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(0);
    expect(await balance()).toBe(1_000);
    expect((await refund(refundRequest(order.id, true))).status).toBe(409);
    expect((await database.select().from(schema.orders))[0].status).toBe("review");
    expect(await balance()).toBe(1_000);
  });

  it("never refunds a refused, uncharged eSIM order, even with reconciliation confirmed", async () => {
    mocks.purchase.mockResolvedValue({ kind: "refused", message: "refused" });
    expect((await purchase(request(randomUUID()))).status).toBe(502);
    const [order] = await database.select().from(schema.orders);
    expect(order.status).toBe("cancelled");
    expect((await refund(refundRequest(order.id, true))).status).toBe(409);
    expect((await database.select().from(schema.orders))[0].status).toBe("cancelled");
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(0);
    expect(await balance()).toBe(50_000);
  });

  it("still allows an ordinary refund of a fully debited eSIM order", async () => {
    expect((await purchase(request(randomUUID()))).status).toBe(200);
    const [order] = await database.select().from(schema.orders);
    expect((await refund(refundRequest(order.id))).status).toBe(200);
    expect((await database.select().from(schema.orders))[0].status).toBe("refunded");
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(2);
    expect(await balance()).toBe(50_000);
  });
});
