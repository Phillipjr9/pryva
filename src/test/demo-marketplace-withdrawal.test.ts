import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/rate-limit", () => ({ purchaseRateLimiter: async () => ({ allowed: true }) }));
let database: typeof import("@/db");
let schema: typeof import("@/db/schema");
let marketplace: typeof import("@/lib/demo-marketplace");
let accounts: typeof import("@/app/api/demo/accounts/route");
let withdrawal: typeof import("@/app/api/demo/wallet/withdraw/route");

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  [database, schema, marketplace, accounts, withdrawal] = await Promise.all([
    import("@/db"), import("@/db/schema"), import("@/lib/demo-marketplace"),
    import("@/app/api/demo/accounts/route"), import("@/app/api/demo/wallet/withdraw/route"),
  ]);
});
beforeEach(() => { vi.stubEnv("DATABASE_URL", ""); mocks.user.mockReset(); });
async function makeUser(balance = 30000) {
  const id = randomUUID();
  await database.db.insert(schema.users).values({ id, name: "Demo Tester", email: `${id}@example.test`, passwordHash: "hash", walletBalance: balance });
  mocks.user.mockResolvedValue({ id, walletBalance: balance });
  return id;
}
function request(path: string, body: unknown, origin = "https://pryva.test") {
  return new NextRequest(`https://pryva.test${path}`, { method: "POST", headers: { host: "pryva.test", "x-forwarded-proto": "https", origin, "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("safe marketplace and withdrawal demos", () => {
  it("reserves demo account stock and delivers only fictional samples, idempotently", async () => {
    const id = await makeUser();
    const before = marketplace.demoMarketplaceInventory(id).find((row) => row.slug === "demo-gmail")!;
    const body = { slug: "demo-gmail", quantity: 2, requestId: randomUUID(), price: 1 };
    const [first, retry] = await Promise.all([accounts.POST(request("/api/demo/accounts", body)), accounts.POST(request("/api/demo/accounts", body))]);
    expect(first.status).toBe(200);
    const a = await first.json(), b = await retry.json();
    expect(a.orderId).toBe(b.orderId);
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    const order = await database.db.query.orders.findFirst({ where: eq(schema.orders.id, a.orderId) });
    expect(order).toMatchObject({ amount: 1500, provider: "simulated", status: "delivered" });
    expect(JSON.parse(order!.accounts!)).toEqual([expect.stringContaining("@example.test"), expect.stringContaining("@example.test")]);
    expect(marketplace.demoMarketplaceInventory(id).find((row) => row.slug === "demo-gmail")).toMatchObject({ stock: before.stock - 2, owned: 2 });
    expect(marketplace.demoMarketplaceInventory(randomUUID()).find((row) => row.slug === "demo-gmail")?.owned).toBe(0);
    expect((await database.db.query.users.findFirst({ where: eq(schema.users.id, id) }))?.walletBalance).toBe(28500);
    expect((await accounts.POST(request("/api/demo/accounts", { ...body, quantity: 3 }))).status).toBe(409);
  });

  it("simulates a withdrawal once with a fixed fictional destination and rejects bank data", async () => {
    const id = await makeUser();
    const body = { amount: 10000, requestId: randomUUID() };
    expect((await withdrawal.POST(request("/api/demo/wallet/withdraw", { ...body, bankAccount: "1234567890" }))).status).toBe(400);
    const [first, retry] = await Promise.all([withdrawal.POST(request("/api/demo/wallet/withdraw", body)), withdrawal.POST(request("/api/demo/wallet/withdraw", body))]);
    expect(first.status).toBe(200);
    const a = await first.json(), b = await retry.json();
    expect(a.reference).toBe(b.reference);
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    expect(a).toMatchObject({ amount: 10000, fee: 100, balance: 19900 });
    expect(b).toMatchObject({ amount: 10000, fee: 100, balance: 19900 });
    expect((await database.db.query.users.findFirst({ where: eq(schema.users.id, id) }))?.walletBalance).toBe(19900);
    const history = await (await withdrawal.GET()).json();
    expect(history.withdrawals).toHaveLength(1);
    expect(history.withdrawals[0]).toMatchObject({ amount: 10000, fee: 100 });
    expect(JSON.stringify(history)).not.toContain("1234567890");
    expect((await withdrawal.POST(request("/api/demo/wallet/withdraw", { ...body, amount: 2000 }))).status).toBe(409);
    const transactions = await database.db.query.walletTransactions.findMany({ where: eq(schema.walletTransactions.userId, id) });
    expect(transactions).toHaveLength(1);
  });

  it("keeps every demo endpoint behind auth, same-origin and preview-only guards", async () => {
    await makeUser();
    const body = { amount: 1000, requestId: randomUUID() };
    expect((await withdrawal.POST(request("/api/demo/wallet/withdraw", body, "https://evil.test"))).status).toBe(403);
    mocks.user.mockResolvedValue(null);
    expect((await accounts.GET()).status).toBe(401);
    vi.stubEnv("DATABASE_URL", "postgres://persistent.test/db");
    expect((await accounts.GET()).status).toBe(404);
    expect((await withdrawal.POST(request("/api/demo/wallet/withdraw", body))).status).toBe(404);
  });
});
