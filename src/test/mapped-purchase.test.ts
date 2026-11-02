import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

/**
 * A purchase against a real supplier must be impossible until a human has
 * mapped a product, and every failure must leave the wallet whole. These tests
 * exercise the whole route against the in-memory database with a mocked
 * FoxReload transport, including the debit, the delivered code and the refund.
 */

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  limit: vi.fn(),
  toNgn: vi.fn(),
  schedule: vi.fn(),
  getProduct: vi.fn(),
  createOrder: vi.fn(),
  payOrder: vi.fn(),
  pollCodes: vi.fn(),
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getCurrentUser: mocks.user };
});
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, purchaseRateLimiter: mocks.limit };
});
vi.mock("@/lib/supplier-currency", () => ({ supplierAmountToNgn: mocks.toNgn }));
vi.mock("@/lib/schedule-wallet-emails", () => ({ scheduleWalletEmails: mocks.schedule }));
vi.mock("@/lib/foxreload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/foxreload")>();
  return {
    ...actual,
    getFoxreloadProduct: mocks.getProduct,
    createFoxreloadOrder: mocks.createOrder,
    payFoxreloadOrder: mocks.payOrder,
    pollFoxreloadOrderCodes: mocks.pollCodes,
  };
});

let POST: typeof import("@/app/api/airtime/purchase/route").POST;
let db: typeof import("@/db").db;
let schema: typeof import("@/db/schema");
let FoxreloadError: typeof import("@/lib/foxreload").FoxreloadError;
let temp: string;

const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID_2 = "44444444-4444-4444-8444-444444444444";
const USER_ID = "demo-user";

function post(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("https://pryva.test/api/airtime/purchase", {
    method: "POST",
    headers: {
      host: "pryva.test",
      "x-forwarded-proto": "https",
      origin: "https://pryva.test",
      "content-type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const valid = () => ({ planId: "mtn-1gb", requestId: REQUEST_ID });

beforeAll(async () => {
  // The failure cases deliberately log wholesale/margin detail for the owner;
  // keep that out of the test output without weakening the assertions.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("FOXRELOAD_IS_MOCK", "true");
  vi.stubEnv("FOXRELOAD_API_KEY", "ak_test_key");
  temp = mkdtempSync(path.join(tmpdir(), "pryva-purchase-"));
  const file = path.join(temp, "product-mappings.json");
  writeFileSync(file, JSON.stringify({
    schema: 1,
    products: [{ family: "data", planId: "mtn-1gb", productId: "product_data1" }],
  }));
  vi.stubEnv("PRODUCT_MAPPINGS_FILE", file);
  ({ POST } = await import("@/app/api/airtime/purchase/route"));
  ({ db } = await import("@/db"));
  schema = await import("@/db/schema");
  ({ FoxreloadError } = await import("@/lib/foxreload"));
});

afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: USER_ID, email: "buyer@pryva.ng" });
  mocks.limit.mockResolvedValue({ allowed: true, unavailable: false });
  mocks.schedule.mockReturnValue(undefined);
  mocks.toNgn.mockResolvedValue(500);
  mocks.getProduct.mockResolvedValue({
    id: "product_data1",
    name: "MTN 1GB PIN",
    slug: "mtn-1gb",
    categoryId: "cat",
    price: 0.3,
    currency: "usd",
    quantity: 10,
    deliveryType: "code",
  });
  mocks.createOrder.mockResolvedValue({ id: "upstream-1", status: "pending", items: [] });
  mocks.payOrder.mockResolvedValue({ orderId: "upstream-1", status: "processing" });
  mocks.pollCodes.mockResolvedValue(["MTN-PIN-4821"]);
  // Start each case from a known balance; seeded orders are left alone.
  await db.update(schema.users).set({ walletBalance: 50_000 }).where(eq(schema.users.id, USER_ID));
  await db.delete(schema.orders).where(and(eq(schema.orders.userId, USER_ID), eq(schema.orders.requestId, REQUEST_ID)));
  await db.delete(schema.orders).where(and(eq(schema.orders.userId, USER_ID), eq(schema.orders.requestId, REQUEST_ID_2)));
});

async function balance() {
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, USER_ID)).limit(1);
  return row.walletBalance;
}

async function orderFor(requestId: string) {
  const [row] = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.userId, USER_ID), eq(schema.orders.requestId, requestId)))
    .limit(1);
  return row;
}

describe("POST /api/airtime/purchase", () => {
  it("requires a session, same origin, JSON and a UUID request id", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await POST(post(valid()))).status).toBe(401);

    const cross = await POST(post(valid(), { "sec-fetch-site": "cross-site" }));
    expect(cross.status).toBe(403);

    const text = new NextRequest("https://pryva.test/api/airtime/purchase", {
      method: "POST",
      headers: {
        host: "pryva.test",
        "x-forwarded-proto": "https",
        origin: "https://pryva.test",
        "content-type": "text/plain",
      },
      body: "{}",
    });
    expect((await POST(text)).status).toBe(415);

    expect((await POST(post({ planId: "mtn-1gb", requestId: "not-a-uuid" }))).status).toBe(400);
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });

  it("fails closed without leaking configuration or sourcing detail", async () => {
    vi.stubEnv("FOXRELOAD_API_KEY", "");
    const response = await POST(post(valid()));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toContain("not available");
    // Operator detail lives in the diagnostics endpoint, never in a shopper's
    // response body where devtools could read it.
    expect(JSON.stringify(body)).not.toContain("FOXRELOAD");
    expect(body.missing).toBeUndefined();
    expect(mocks.createOrder).not.toHaveBeenCalled();
    expect(await balance()).toBe(50_000);
    vi.stubEnv("FOXRELOAD_API_KEY", "ak_test_key");
  });

  it("refuses a plan that has no verified mapping", async () => {
    const response = await POST(post({ planId: "mtn-2gb", requestId: REQUEST_ID_2 }));
    expect(response.status).toBe(404);
    expect(mocks.createOrder).not.toHaveBeenCalled();
    expect(await orderFor(REQUEST_ID_2)).toBeUndefined();
  });

  it("refuses a product that does not deliver a code, before any debit", async () => {
    mocks.getProduct.mockResolvedValueOnce({
      id: "product_data1", name: "MTN direct topup", slug: "x", categoryId: "c",
      price: 0.3, currency: "usd", quantity: 10, deliveryType: "direct_topup",
    });
    expect((await POST(post(valid()))).status).toBe(503);
    expect(mocks.createOrder).not.toHaveBeenCalled();
    expect(await balance()).toBe(50_000);
  });

  it("refuses a mapping whose real supplier cost breaks the margin floor", async () => {
    mocks.toNgn.mockResolvedValueOnce(2_000);
    expect((await POST(post(valid()))).status).toBe(503);
    expect(mocks.createOrder).not.toHaveBeenCalled();
    expect(await balance()).toBe(50_000);
  });

  it("delivers the code, debits exactly the catalogue price and records the order", async () => {
    const response = await POST(post(valid()));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, code: "MTN-PIN-4821", replayed: false });
    expect(mocks.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: "product_data1", quantity: 1, idempotencyKey: REQUEST_ID, isMock: true }),
    );

    const order = await orderFor(REQUEST_ID);
    expect(order).toMatchObject({
      service: "data",
      productSlug: "mtn-1gb",
      amount: 1000,
      status: "delivered",
      provider: "foxreload",
      referenceCode: "MTN-PIN-4821",
      providerRequestId: "upstream-1",
    });
    expect(await balance()).toBe(49_000);
  });

  it("replays a duplicate request without buying a second unit or debiting twice", async () => {
    await POST(post(valid()));
    mocks.createOrder.mockClear();
    const replay = await POST(post(valid()));
    const body = await replay.json();
    expect(body).toMatchObject({ ok: true, replayed: true, code: "MTN-PIN-4821" });
    expect(mocks.createOrder).not.toHaveBeenCalled();
    expect(await balance()).toBe(49_000);
  });

  it("refunds the wallet and marks the order refunded when delivery fails", async () => {
    mocks.pollCodes.mockRejectedValueOnce(new FoxreloadError("Provider timed out", 502, "NO_CODE"));
    const response = await POST(post(valid()));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("refunded");
    expect(await balance()).toBe(50_000);
    expect(await orderFor(REQUEST_ID)).toMatchObject({ status: "refunded" });
  });
});
