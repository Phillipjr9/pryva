import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/rate-limit", async (original) => ({ ...(await original<typeof import("@/lib/rate-limit")>()), purchaseRateLimiter: async () => ({ allowed: true }) }));
vi.mock("@/lib/gift-card-requests", async (original) => ({ ...(await original<typeof import("@/lib/gift-card-requests")>()), giftCardAttemptLimit: async () => null }));
let db: typeof import("@/db");
let schema: typeof import("@/db/schema");
let services: typeof import("@/lib/demo-services");
let digital: typeof import("@/lib/demo-digital");
let digitalRoute: typeof import("@/app/api/demo/digital/route");
let scheduleRoute: typeof import("@/app/api/demo/schedules/[id]/run/route");
let giftCreate: typeof import("@/app/api/demo/gift-cards/create/route");
let giftRedeem: typeof import("@/app/api/demo/gift-cards/redeem/route");

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  [db, schema, services, digital, digitalRoute, scheduleRoute, giftCreate, giftRedeem] = await Promise.all([
    import("@/db"), import("@/db/schema"), import("@/lib/demo-services"), import("@/lib/demo-digital"),
    import("@/app/api/demo/digital/route"), import("@/app/api/demo/schedules/[id]/run/route"),
    import("@/app/api/demo/gift-cards/create/route"), import("@/app/api/demo/gift-cards/redeem/route"),
  ]);
});
beforeEach(() => { vi.stubEnv("DATABASE_URL", ""); mocks.user.mockReset(); });
async function user(balance = 50000) {
  const id = randomUUID();
  await db.db.insert(schema.users).values({ id, name: "Demo Tester", email: `${id}@example.test`, passwordHash: "hash", walletBalance: balance });
  mocks.user.mockResolvedValue({ id, walletBalance: balance });
  return id;
}
function request(path: string, body: unknown, origin = "https://pryva.test") {
  return new NextRequest(`https://pryva.test${path}`, { method: "POST", headers: { host: "pryva.test", "x-forwarded-proto": "https", origin, "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("additional demo workflows", () => {
  it("creates a data order only for a fixed fictional destination and tracks stock", async () => {
    const id = await user();
    const before = services.demoInventory(id, "ng")["data-mtn-1gb"];
    const result = services.purchaseDemoService({ userId: id, itemId: "data-mtn-1gb", countryCode: "ng", requestId: randomUUID() });
    const order = await db.db.query.orders.findFirst({ where: eq(schema.orders.id, result.orderId) });
    expect(order).toMatchObject({ service: "data", provider: "simulated", referenceCode: "Fictional demo mobile", status: "delivered" });
    expect(services.demoInventory(id, "ng")["data-mtn-1gb"]).toEqual({ stock: before.stock - 1, owned: 1 });
    expect(services.demoService("data-mtn-1gb", "gb")).toBeNull();
  });

  it("tracks subscription stock, credits ownership and never charges twice on retry", async () => {
    const id = await user();
    const before = digital.demoDigitalInventory(id)["netflix-1month"];
    const body = { planId: "netflix-1month", requestId: randomUUID() };
    const first = await digitalRoute.POST(request("/api/demo/digital", body));
    const retry = await digitalRoute.POST(request("/api/demo/digital", body));
    expect(first.status).toBe(200);
    const a = await first.json(), b = await retry.json();
    expect(a.orderId).toBe(b.orderId);
    expect(b.duplicate).toBe(true);
    expect(digital.demoDigitalInventory(id)[body.planId]).toEqual({ stock: before.stock - 1, owned: 1 });
    expect(services.demoInventory(id, "ng")["subscription-netflix"].owned).toBe(1);
    expect((await db.db.query.orders.findFirst({ where: eq(schema.orders.id, a.orderId) }))?.referenceCode).toContain("no account access");
  });

  it("manually runs an owned schedule as a simulated order, with a stable retry", async () => {
    const id = await user();
    const scheduleId = randomUUID();
    await db.db.insert(schema.scheduledOrders).values({ id: scheduleId, userId: id, service: "numbers", productSlug: "vn-otp-5", frequency: "monthly", nextRunAt: new Date(Date.now() + 86400000), status: "active" });
    const path = `/api/demo/schedules/${scheduleId}/run`;
    const params = { params: Promise.resolve({ id: scheduleId }) };
    const body = { requestId: randomUUID() };
    const first = await scheduleRoute.POST(request(path, body), params);
    const retry = await scheduleRoute.POST(request(path, body), params);
    expect(first.status).toBe(200);
    const a = await first.json(), b = await retry.json();
    expect(a.orderId).toBe(b.orderId);
    expect(b.duplicate).toBe(true);
    const order = await db.db.query.orders.findFirst({ where: eq(schema.orders.id, a.orderId) });
    expect(order).toMatchObject({ provider: "simulated", service: "numbers", otpCode: null, demoUnitsRemaining: 5 });
    expect(await db.db.query.walletTransactions.findMany({ where: eq(schema.walletTransactions.userId, id) })).toHaveLength(1);
    await user();
    expect((await scheduleRoute.POST(request(path, { requestId: randomUUID() }), params)).status).toBe(409);
  });

  it("creates and redeems one demo gift card in the same account without recipient details", async () => {
    const id = await user();
    const body = { amount: 2000, requestId: randomUUID() };
    expect((await giftCreate.POST(request("/api/demo/gift-cards/create", { ...body, recipientEmail: "real@example.com" }))).status).toBe(400);
    const a = await (await giftCreate.POST(request("/api/demo/gift-cards/create", body))).json();
    const b = await (await giftCreate.POST(request("/api/demo/gift-cards/create", body))).json();
    expect(a.code).toBe(b.code);
    expect(b.duplicate).toBe(true);
    const redeem = request("/api/demo/gift-cards/redeem", { code: a.code });
    expect((await giftRedeem.POST(redeem)).status).toBe(200);
    expect((await giftRedeem.POST(request("/api/demo/gift-cards/redeem", { code: a.code }))).status).toBe(400);
    expect((await db.db.query.users.findFirst({ where: eq(schema.users.id, id) }))?.walletBalance).toBe(50000);
  });

  it("rejects cross-origin and persistent-database requests", async () => {
    await user();
    const body = { planId: "netflix-1month", requestId: randomUUID() };
    expect((await digitalRoute.POST(request("/api/demo/digital", body, "https://evil.test"))).status).toBe(403);
    vi.stubEnv("DATABASE_URL", "postgres://persistent.test/db");
    expect((await digitalRoute.POST(request("/api/demo/digital", body))).status).toBe(404);
    expect((await giftCreate.POST(request("/api/demo/gift-cards/create", { amount: 2000, requestId: randomUUID() }))).status).toBe(404);
  });
});
