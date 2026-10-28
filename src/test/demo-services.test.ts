import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/rate-limit", () => ({ purchaseRateLimiter: async () => ({ allowed: true }) }));
let database: typeof import("@/db");
let schema: typeof import("@/db/schema");
let services: typeof import("@/lib/demo-services");
let delivery: typeof import("@/lib/demo-delivery");
let buy: typeof import("@/app/api/demo/services/purchase/route");
let nextCode: typeof import("@/app/api/demo/orders/[id]/next/route");

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  [database, schema, services, delivery, buy, nextCode] = await Promise.all([
    import("@/db"), import("@/db/schema"), import("@/lib/demo-services"), import("@/lib/demo-delivery"),
    import("@/app/api/demo/services/purchase/route"), import("@/app/api/demo/orders/[id]/next/route"),
  ]);
});
beforeEach(() => { vi.stubEnv("DATABASE_URL", ""); mocks.user.mockReset(); });
async function user(balance = 50000) {
  const id = randomUUID();
  await database.db.insert(schema.users).values({ id, name: "Demo Tester", email: `${id}@example.test`, passwordHash: "hash", walletBalance: balance });
  mocks.user.mockResolvedValue({ id, walletBalance: balance });
  return id;
}
function request(path: string, body: unknown, origin = "https://pryva.test") {
  return new NextRequest(`https://pryva.test${path}`, { method: "POST", headers: { host: "pryva.test", "x-forwarded-proto": "https", origin, "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("demo service orders and inventory", () => {
  it("uses server-side terms, charges once, and consumes one verification unit when the code arrives", async () => {
    const id = await user();
    const before = services.demoInventory(id, "ng")["verification-whatsapp"];
    const body = { itemId: "verification-whatsapp", country: "ng", requestId: randomUUID(), price: 1 };
    const [first, retry] = await Promise.all([buy.POST(request("/api/demo/services/purchase", body)), buy.POST(request("/api/demo/services/purchase", body))]);
    expect(first.status).toBe(200);
    const a = await first.json(), b = await retry.json();
    expect(a.orderId).toBe(b.orderId);
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    expect((await database.db.query.users.findFirst({ where: eq(schema.users.id, id) }))?.walletBalance).toBe(49250);
    expect(services.demoInventory(id, "ng")[body.itemId]).toEqual({ stock: before.stock - 1, owned: 1 });
    expect(delivery.advanceDemoOtp(id, a.orderId, Date.now() + 9000)?.otpCode).toMatch(/^\d{6}$/);
    expect(services.demoInventory(id, "ng")[body.itemId]).toEqual({ stock: before.stock - 1, owned: 0 });
    expect(services.demoInventory(randomUUID(), "ng")[body.itemId].owned).toBe(0);
    expect((await buy.POST(request("/api/demo/services/purchase", { ...body, itemId: "verification-instagram" }))).status).toBe(409);
  });

  it("completes a fictional social campaign and decrements its explicitly modeled units", async () => {
    const id = await user();
    const before = services.demoInventory(id, "gb")["social-instagram-followers"];
    const result = services.purchaseDemoService({ userId: id, itemId: "social-instagram-followers", countryCode: "gb", requestId: randomUUID() });
    expect(services.demoInventory(id, "gb")["social-instagram-followers"]).toEqual({ stock: before.stock - 100, owned: 100 });
    expect(delivery.advanceDemoPromotion(id, result.orderId, Date.now() + 9000)).toMatchObject({ status: "delivered", waiting: false });
    expect(services.demoInventory(id, "gb")["social-instagram-followers"].owned).toBe(0);
    expect((await database.db.query.orders.findFirst({ where: eq(schema.orders.id, result.orderId) }))?.provider).toBe("simulated");
  });

  it("allows remaining bundle units to produce subsequent demo codes without another debit", async () => {
    const id = await user();
    const result = services.purchaseDemoService({ userId: id, itemId: "plan-vn-otp-5", countryCode: "ng", requestId: randomUUID() });
    delivery.advanceDemoOtp(id, result.orderId, Date.now() + 9000);
    expect(services.demoInventory(id, "ng")["plan-vn-otp-5"].owned).toBe(4);
    const body = { requestId: randomUUID() };
    const params = { params: Promise.resolve({ id: result.orderId }) };
    const path = `/api/demo/orders/${result.orderId}/next`;
    expect((await nextCode.POST(request(path, body), params)).status).toBe(200);
    expect((await nextCode.POST(request(path, { requestId: randomUUID() }), params)).status).toBe(409);
    const second = delivery.advanceDemoOtp(id, result.orderId, Date.now() + 9000);
    expect(second?.otpCode).toMatch(/^\d{6}$/);
    expect(services.demoInventory(id, "ng")["plan-vn-otp-5"].owned).toBe(3);
    expect((await nextCode.POST(request(path, body), params)).status).toBe(200);
    expect(delivery.advanceDemoOtp(id, result.orderId, Date.now() + 10000)?.otpCode).toBe(second?.otpCode);
    expect(services.demoInventory(id, "ng")["plan-vn-otp-5"].owned).toBe(3);
    expect(await database.db.query.walletTransactions.findMany({ where: eq(schema.walletTransactions.userId, id) })).toHaveLength(1);
  });

  it("rejects unsupported items, invalid countries, cross-origin and live-database requests", async () => {
    await user();
    const body = { itemId: "verification-whatsapp", country: "ng", requestId: randomUUID() };
    expect((await buy.POST(request("/api/demo/services/purchase", body, "https://evil.test"))).status).toBe(403);
    expect((await buy.POST(request("/api/demo/services/purchase", { ...body, country: "narnia" }))).status).toBe(400);
    expect((await buy.POST(request("/api/demo/services/purchase", { ...body, itemId: "fake-item" }))).status).toBe(400);
    vi.stubEnv("DATABASE_URL", "postgres://persistent.test/db");
    expect((await buy.POST(request("/api/demo/services/purchase", body))).status).toBe(404);
  });
});
