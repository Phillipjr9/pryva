import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  // Injected in beforeAll: this test needs a database that really rolls back.
  db: null as unknown,
  currentUser: vi.fn(),
  fulfillPlan: vi.fn(),
  cancelUpstream: vi.fn(),
  rateLimit: vi.fn(),
  scheduleWalletEmails: vi.fn(),
}));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/fulfillment", () => ({
  fulfillPlan: mocks.fulfillPlan,
  cancelUpstream: mocks.cancelUpstream,
}));
vi.mock("@/lib/schedule-wallet-emails", () => ({ scheduleWalletEmails: mocks.scheduleWalletEmails }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, purchaseRateLimiter: mocks.rateLimit };
});

// PGlite, not the in-memory preview adapter: that adapter implements
// transaction() as a bare callback with no rollback (src/db/index.ts:891), so it
// cannot verify the one guarantee this file exists to protect.
let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let POST: typeof import("@/app/api/orders/route").POST;
let findPlan: typeof import("@/lib/catalog").findPlan;

const USER = "11111111-1111-4111-8111-111111111111";
const SLUG = "vn-ng";
const MIGRATIONS = [
  "0000_base_schema.sql", "0001_google_subject.sql", "0002_shared_rate_limits.sql",
  "0003_withdrawal_idempotency.sql", "0004_paystack_transfer_reference.sql",
  "0005_wallet_email_outbox.sql", "0006_order_idempotency.sql",
  "0007_order_reconciliation_note.sql",
  "0008_order_provider_cost.sql",
  "0009_password_reset_tokens.sql",
  "0010_order_provider_no_default.sql", "0011_email_verification.sql", "0012_topup_payer_name.sql", "0013_disposable_inboxes.sql",
];

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "postgres://embedded-test/db");
  pg = new PGlite();
  for (const file of MIGRATIONS) {
    await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  }
  database = drizzle(pg, { schema });
  mocks.db = database;
  ({ findPlan } = await import("@/lib/catalog"));
  ({ POST } = await import("@/app/api/orders/route"));
  await database.insert(schema.users).values({
    id: USER, name: "Buyer", email: "buyer@example.com", passwordHash: "hash", walletBalance: 500_000,
  });
});
afterAll(async () => { vi.unstubAllEnvs(); await pg?.close(); });

function purchase(body: unknown) {
  return new Request("https://pryva.test/api/orders", {
    method: "POST",
    headers: {
      host: "pryva.test", "x-forwarded-proto": "https",
      origin: "https://pryva.test", "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

const walletBalance = async () => {
  const [row] = await database.select({ balance: schema.users.walletBalance })
    .from(schema.users).where(eq(schema.users.id, USER)).limit(1);
  return row?.balance ?? 0;
};
const ledgerCount = async () =>
  (await database.select().from(schema.walletTransactions)
    .where(eq(schema.walletTransactions.userId, USER))).length;
const ordersFor = async (requestId: string) =>
  (await database.select().from(schema.orders).where(eq(schema.orders.userId, USER)))
    .filter((order) => order.requestId === requestId);

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.rateLimit.mockResolvedValue({ allowed: true, unavailable: false });
  mocks.currentUser.mockResolvedValue({ id: USER, walletBalance: 500_000, email: "buyer@example.com" });
  mocks.fulfillPlan.mockResolvedValue({
    provider: "fleexa", providerCostNgn: 900, providerRequestId: "req-1",
    referenceCode: "+2348000000000",
    otpCode: null, expiresAt: new Date(Date.now() + 20 * 60_000),
  });
  mocks.cancelUpstream.mockResolvedValue(false);
  await database.delete(schema.walletTransactions);
  await database.delete(schema.orders);
  await database.update(schema.users).set({ walletBalance: 500_000 }).where(eq(schema.users.id, USER));
});

describe("recorded unit cost", () => {
  it("persists what the unit actually cost so real margin is measurable", async () => {
    const requestId = crypto.randomUUID();
    const body = await (await POST(purchase({ planSlug: SLUG, requestId }))).json();
    const [row] = await ordersFor(requestId);

    // Wholesale cost is recorded for the owner and must never reach the buyer:
    // the receipt is an explicit field allowlist, and this keeps it that way.
    expect(JSON.stringify(body)).not.toContain("providerCostNgn");
    expect(JSON.stringify(body)).not.toContain("900");

    // The cost sheet holds planned prices; only this column holds what the
    // supplier really charged, which is the only honest basis for margin.
    expect(row.providerCostNgn).toBe(900);
    expect(row.amount).toBe(findPlan(SLUG)!.price);
  });

  it("records an unknown cost as null rather than zero", async () => {
    mocks.fulfillPlan.mockResolvedValue({
      provider: "fleexa", providerCostNgn: null, providerRequestId: "req-2",
      referenceCode: "+2348000000001", otpCode: null,
      expiresAt: new Date(Date.now() + 20 * 60_000),
    });
    const requestId = crypto.randomUUID();
    await POST(purchase({ planSlug: SLUG, requestId }));
    const [row] = await ordersFor(requestId);

    // Zero would read as "this unit was free" and report a 100% margin on a
    // sale whose real cost was simply never observed. Null keeps the two apart.
    expect(row.providerCostNgn).toBeNull();
  });
});

describe("purchase idempotency", () => {
  it("replays a retried attempt instead of buying a second number", async () => {
    const requestId = crypto.randomUUID();
    const firstBody = await (await POST(purchase({ planSlug: SLUG, requestId }))).json();
    const second = await POST(purchase({ planSlug: SLUG, requestId }));
    const secondBody = await second.json();

    expect(second.status).toBe(200);
    expect(mocks.fulfillPlan).toHaveBeenCalledTimes(1);
    expect(secondBody.order.id).toBe(firstBody.order.id);
    expect(secondBody.order.reference).toBe(firstBody.order.reference);
    expect(firstBody.replayed).toBe(false);
    expect(secondBody.replayed).toBe(true);
    expect(await ordersFor(requestId)).toHaveLength(1);
    expect(500_000 - (await walletBalance())).toBe(findPlan(SLUG)!.price);
  });

  it("treats a separate attempt for the same plan as a separate purchase", async () => {
    // Buying the same plan twice in a row is legitimate for virtual numbers, so
    // deduping on plan or elapsed time would wrongly swallow a real order.
    const firstBody = await (await POST(purchase({ planSlug: SLUG, requestId: crypto.randomUUID() }))).json();
    const secondBody = await (await POST(purchase({ planSlug: SLUG, requestId: crypto.randomUUID() }))).json();
    expect(mocks.fulfillPlan).toHaveBeenCalledTimes(2);
    expect(firstBody.order.id).not.toBe(secondBody.order.id);
    expect(500_000 - (await walletBalance())).toBe(findPlan(SLUG)!.price * 2);
  });

  it("refuses a purchase with no usable key, before buying anything", async () => {
    expect((await POST(purchase({ planSlug: SLUG }))).status).toBe(400);
    expect((await POST(purchase({ planSlug: SLUG, requestId: "not-a-uuid" }))).status).toBe(400);
    expect(mocks.fulfillPlan).not.toHaveBeenCalled();
    expect(await ledgerCount()).toBe(0);
  });

  it("leaves no order row and no charge when the wallet cannot pay", async () => {
    // The regression this guards: the row used to be inserted first and deleted
    // only if the debit failed, so a crash in between left an undebited order
    // that the refund sweep would later credit back as money never taken.
    const requestId = crypto.randomUUID();
    await database.update(schema.users).set({ walletBalance: 0 }).where(eq(schema.users.id, USER));

    const response = await POST(purchase({ planSlug: SLUG, requestId }));

    expect(response.status).toBe(402);
    expect(await ordersFor(requestId)).toHaveLength(0);
    expect(await ledgerCount()).toBe(0);
    // The number was already bought upstream, so it must be released.
    expect(mocks.cancelUpstream).toHaveBeenCalledTimes(1);
  });

  it("rejects a second order reusing another attempt's key at the database level", async () => {
    // Belt and braces: even if the application check is ever bypassed, the unique
    // (user_id, request_id) index must make a duplicate insert impossible.
    const requestId = crypto.randomUUID();
    await database.insert(schema.orders).values({
      reference: "DUP-1", userId: USER, requestId, service: "numbers", productSlug: SLUG,
      productName: "Test", planLabel: "Single", region: "Nigeria", duration: "Single",
      amount: 1000, status: "active", provider: "fleexa",
    });
    await expect(database.insert(schema.orders).values({
      reference: "DUP-2", userId: USER, requestId, service: "numbers", productSlug: SLUG,
      productName: "Test", planLabel: "Single", region: "Nigeria", duration: "Single",
      amount: 1000, status: "active", provider: "fleexa",
    })).rejects.toThrow();
  });

  it("releases the number and records nothing when fulfilment itself fails", async () => {
    mocks.fulfillPlan.mockRejectedValue(new Error("provider exploded"));
    const requestId = crypto.randomUUID();
    const response = await POST(purchase({ planSlug: SLUG, requestId }));
    expect(response.status).toBe(500);
    expect(await ordersFor(requestId)).toHaveLength(0);
    expect(await walletBalance()).toBe(500_000);
  });
});
