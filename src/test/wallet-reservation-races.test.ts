import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

/**
 * The concurrent-spend race, at the route level, against embedded PostgreSQL.
 *
 * These tests exist because the hole they close was invisible to every
 * single-request test: each request was individually correct, and two of them
 * together bought twice. So the assertions here are all about *pairs* of
 * requests — the same wallet, the same instant, one supplier call.
 *
 * Nothing here contacts a supplier or touches a production record: fulfilment is
 * mocked, and the database is a fresh embedded instance built from `migrations/`.
 */

const USER = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  db: null as unknown,
  fulfillPlan: vi.fn(),
  findEsimOffer: vi.fn(),
  recheckEsimOffer: vi.fn(),
  purchaseEsim: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
// The signed-in customer. Authentication itself is covered by the auth suite;
// these tests are about what two requests from the same account can spend.
vi.mock("@/lib/identity/auth", () => ({
  getCurrentUser: async () => ({ id: USER, email: "buyer@example.com", walletBalance: 50_000 }),
  requireAuthApi: async () => ({ id: USER, email: "buyer@example.com", walletBalance: 50_000 }),
}));
vi.mock("@/lib/platform/net", () => ({ isSameOriginMutation: () => true }));
vi.mock("@/lib/platform/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform/rate-limit")>();
  return { ...actual, purchaseRateLimiter: (...args: unknown[]) => mocks.rateLimit(...args) };
});
vi.mock("@/lib/admin/fraud", () => ({
  purchaseVelocity: async () => ({ allowed: true, count: 0, limit: 50 }),
  recordFraudEvent: vi.fn(),
}));
vi.mock("@/lib/email/schedule-wallet-emails", () => ({ scheduleWalletEmails: vi.fn() }));
vi.mock("@/lib/content/referrals", () => ({ settleReferralRewards: async () => ({ credited: 0 }) }));
vi.mock("@/lib/services/fulfillment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/fulfillment")>();
  return { ...actual, fulfillPlan: (...args: unknown[]) => mocks.fulfillPlan(...args) };
});
vi.mock("@/lib/services/esim/esim-catalog", () => ({
  findEsimOffer: (...args: unknown[]) => mocks.findEsimOffer(...args),
  recheckEsimOffer: (...args: unknown[]) => mocks.recheckEsimOffer(...args),
  esimOfferTerms: () => "a".repeat(24),
}));
vi.mock("@/lib/services/esim/esim-fulfilment", () => ({
  purchaseEsim: (...args: unknown[]) => mocks.purchaseEsim(...args),
}));

const NUMBER_SLUG = "vn-ng";
const ESIM_OFFER_ID = "live-esim-feedc0ffee1234567890";

let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let ordersRoute: typeof import("@/app/api/orders/route");
let esimRoute: typeof import("@/app/api/esim/purchase/route");

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "postgres://embedded-test/db");
  vi.stubEnv("VERCEL_ENV", "");
  pg = new PGlite();
  const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema });
  mocks.db = database;
  ordersRoute = await import("@/app/api/orders/route");
  esimRoute = await import("@/app/api/esim/purchase/route");
}, 30_000);

afterAll(async () => {
  await pg?.close();
  vi.unstubAllEnvs();
});

async function plan() {
  const { findPlan } = await import("@/lib/services/catalog");
  const found = findPlan(NUMBER_SLUG);
  if (!found) throw new Error("the number plan fixture is missing");
  return found;
}

let planPrice = 0;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.rateLimit.mockResolvedValue({ allowed: true, unavailable: false });
  await pg.exec('TRUNCATE TABLE "users" CASCADE');
  await database.insert(schema.users).values({
    id: USER, name: "Buyer", email: "buyer@example.com", passwordHash: "hash", walletBalance: 0,
  });
  planPrice = (await plan()).price;
  mocks.fulfillPlan.mockResolvedValue({
    provider: "fleexa", providerCostNgn: Math.floor(planPrice / 2),
    providerRequestId: "req-1", referenceCode: "+2348000000000",
    otpCode: null, expiresAt: new Date(Date.now() + 20 * 60_000),
  });
  const offer = {
    id: ESIM_OFFER_ID, planId: "pln_live", name: "Nigeria Lite", region: "Africa",
    dataLabel: "1GB of data", validityLabel: "7 days", countries: ["Nigeria"],
    coverage: "catalog-country" as const, costNgn: 7_200, priceNgn: 9_800, purchasable: true,
  };
  mocks.findEsimOffer.mockResolvedValue(offer);
  mocks.recheckEsimOffer.mockResolvedValue(offer);
  mocks.purchaseEsim.mockResolvedValue({
    kind: "delivered",
    delivery: {
      provider: "bitcall", providerRequestId: "ord_provider", iccid: "8944000000000000001",
      activationCode: "LPA:1$rsp.example$ABC", installUrl: null,
    },
  });
});

async function fund(amount: number) {
  await database.update(schema.users).set({ walletBalance: amount, walletReserved: 0 }).where(eq(schema.users.id, USER));
}

async function account() {
  const [row] = await database.select({
    balance: schema.users.walletBalance, reserved: schema.users.walletReserved,
  }).from(schema.users).where(eq(schema.users.id, USER));
  return row;
}

async function holds() {
  return database.select().from(schema.walletReservations);
}

async function debits() {
  const rows = await database.select().from(schema.walletTransactions);
  return rows.filter((row) => row.type === "debit");
}

function numberRequest(body: unknown) {
  return new Request("https://pryva.test/api/orders", {
    method: "POST",
    headers: {
      host: "pryva.test", "x-forwarded-proto": "https", origin: "https://pryva.test",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function esimRequest(body: unknown) {
  return new Request("https://pryva.test/api/esim/purchase", {
    method: "POST",
    headers: {
      host: "pryva.test", "x-forwarded-proto": "https", origin: "https://pryva.test",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

const esimBody = (requestId: string) => ({
  offerId: ESIM_OFFER_ID, requestId, expectedPriceNgn: 9_800, expectedTerms: "a".repeat(24),
});

describe("two number orders racing one wallet", () => {
  it("lets the supplier be paid for exactly one of them", async () => {
    // One plan's worth of money, two different attempts submitted together. This
    // is the exact shape of the old bug: both read a sufficient balance, both
    // called `fulfillPlan`, and one of them ended up delivered-but-uncharged.
    await fund(planPrice);
    const [first, second] = await Promise.all([
      ordersRoute.POST(numberRequest({ planSlug: NUMBER_SLUG, requestId: randomUUID() })),
      ordersRoute.POST(numberRequest({ planSlug: NUMBER_SLUG, requestId: randomUUID() })),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 402]);
    expect(mocks.fulfillPlan).toHaveBeenCalledTimes(1);
    expect(await debits()).toHaveLength(1);
    expect((await account())).toEqual({ balance: 0, reserved: 0 });
  });

  it("buys once for one attempt key even when it is submitted twice at once", async () => {
    await fund(planPrice * 2);
    const requestId = randomUUID();
    const responses = await Promise.all([
      ordersRoute.POST(numberRequest({ planSlug: NUMBER_SLUG, requestId })),
      ordersRoute.POST(numberRequest({ planSlug: NUMBER_SLUG, requestId })),
    ]);
    expect(responses.filter((response) => response.status === 200)).toHaveLength(2);
    expect(mocks.fulfillPlan).toHaveBeenCalledTimes(1);
    expect(await debits()).toHaveLength(1);
    expect((await account())).toEqual({ balance: planPrice, reserved: 0 });
    // One order, one hold, both settled.
    expect((await database.select().from(schema.orders)).filter((o) => o.requestId === requestId)).toHaveLength(1);
    const rows = await holds();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("settled");
  });

  it("leaves nothing held and nothing spent when the supplier never confirms", async () => {
    mocks.fulfillPlan.mockRejectedValue(new Error("provider refused before starting"));
    await fund(50_000);
    const response = await ordersRoute.POST(numberRequest({ planSlug: NUMBER_SLUG, requestId: randomUUID() }));
    expect(response.status).toBe(503);
    expect((await account())).toEqual({ balance: 50_000, reserved: 0 });
    const [hold] = await holds();
    expect(hold.status).toBe("released");
    expect(await debits()).toHaveLength(0);
  });

  it("parks both the order and the funds when the outcome is uncertain", async () => {
    // A paid call that dies without a verdict: no retry, no refund, no guess.
    // Only the rental intent is treated as ambiguous on an unknown error, so the
    // test drives that path; if the catalogue has no rental fixture it says so
    // rather than passing silently.
    const { fulfilmentIntent } = await import("@/lib/services/fulfillment");
    const { plans } = await import("@/lib/services/catalog");
    const rentalSlug = plans.find((entry) => fulfilmentIntent(entry.slug)?.kind === "rental")?.slug;
    expect(rentalSlug, "a rental plan fixture is required for this branch").toBeTruthy();

    mocks.fulfillPlan.mockImplementation(async (_plan: unknown, hooks: { onRentalAttempt?: () => Promise<void> } | undefined) => {
      await hooks?.onRentalAttempt?.();
      throw new Error("socket hang up");
    });
    await fund(200_000);
    const response = await ordersRoute.POST(numberRequest({ planSlug: rentalSlug, requestId: randomUUID() }));
    expect(response.status).toBe(202);
    const [hold] = await holds();
    expect(hold.status).toBe("review");
    expect((await account()).reserved).toBe(hold.amount);
    expect(await debits()).toHaveLength(0);
  });
});

describe("two eSIM purchases racing one wallet", () => {
  it("reserves once and charges once for one plan's worth of money", async () => {
    await fund(9_800);
    const [first, second] = await Promise.all([
      esimRoute.POST(esimRequest(esimBody(randomUUID()))),
      esimRoute.POST(esimRequest(esimBody(randomUUID()))),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 402]);
    expect(mocks.purchaseEsim).toHaveBeenCalledTimes(1);
    expect(await debits()).toHaveLength(1);
    expect((await account())).toEqual({ balance: 0, reserved: 0 });
  });

  it("buys one profile when the same attempt is submitted twice", async () => {
    await fund(20_000);
    const requestId = randomUUID();
    const responses = await Promise.all([
      esimRoute.POST(esimRequest(esimBody(requestId))),
      esimRoute.POST(esimRequest(esimBody(requestId))),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(mocks.purchaseEsim).toHaveBeenCalledTimes(1);
    expect(await debits()).toHaveLength(1);
    expect((await account())).toEqual({ balance: 10_200, reserved: 0 });
  });

  it("releases the hold when the supplier refuses, without charging", async () => {
    mocks.purchaseEsim.mockResolvedValue({ kind: "refused", message: "no" });
    await fund(20_000);
    const response = await esimRoute.POST(esimRequest(esimBody(randomUUID())));
    expect(response.status).toBe(502);
    expect((await account())).toEqual({ balance: 20_000, reserved: 0 });
    expect((await holds())[0].status).toBe("released");
    expect(await debits()).toHaveLength(0);
  });

  it("parks the funds for a human when the supplier outcome is unknown", async () => {
    mocks.purchaseEsim.mockResolvedValue({ kind: "unknown", message: "timeout" });
    await fund(20_000);
    const response = await esimRoute.POST(esimRequest(esimBody(randomUUID())));
    expect(response.status).toBe(202);
    const [hold] = await holds();
    expect(hold.status).toBe("review");
    expect((await account())).toEqual({ balance: 20_000, reserved: 9_800 });
    expect(await debits()).toHaveLength(0);
  });

  it("keeps the funds held while the profile provisions, and settles on completion", async () => {
    mocks.purchaseEsim.mockResolvedValue({ kind: "pending", providerRequestId: "ord_pending" });
    await fund(20_000);
    const response = await esimRoute.POST(esimRequest(esimBody(randomUUID())));
    expect(response.status).toBe(202);
    const [hold] = await holds();
    expect(hold.status).toBe("held");
    expect((await account())).toEqual({ balance: 20_000, reserved: 9_800 });
    expect(await debits()).toHaveLength(0);

    // The remaining money is still spendable — it is the held 9,800 that is not.
    // A second plan fits, and it too holds its price while it provisions.
    const second = await esimRoute.POST(esimRequest(esimBody(randomUUID())));
    expect(second.status).toBe(202);
    expect(mocks.purchaseEsim).toHaveBeenCalledTimes(2);
    expect((await account())).toEqual({ balance: 20_000, reserved: 19_600 });
    // Neither has been charged: a pending profile costs the customer nothing yet.
    expect(await debits()).toHaveLength(0);
  });

  it("refuses a purchase the held funds cannot cover, before any supplier call", async () => {
    mocks.purchaseEsim.mockResolvedValue({ kind: "pending", providerRequestId: "ord_pending" });
    await fund(9_800);
    expect((await esimRoute.POST(esimRequest(esimBody(randomUUID())))).status).toBe(202);
    mocks.purchaseEsim.mockClear();

    const second = await esimRoute.POST(esimRequest(esimBody(randomUUID())));
    expect(second.status).toBe(402);
    expect(mocks.purchaseEsim).not.toHaveBeenCalled();
    expect((await account())).toEqual({ balance: 9_800, reserved: 9_800 });
  });
});
