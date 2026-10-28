import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { TopUpForm } from "@/components/dashboard/TopUpForm";

const mocks = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/rate-limit", () => ({ purchaseRateLimiter: async () => ({ allowed: true }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

let database: typeof import("@/db");
let schema: typeof import("@/db/schema");
let route: typeof import("@/app/api/demo/wallet/topup/route");

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  [database, schema, route] = await Promise.all([import("@/db"), import("@/db/schema"), import("@/app/api/demo/wallet/topup/route")]);
});
beforeEach(() => { vi.stubEnv("DATABASE_URL", ""); mocks.user.mockReset(); });

async function createUser(balance = 1000) {
  const id = randomUUID();
  await database.db.insert(schema.users).values({ id, name: "Tester", email: `${id}@example.test`, passwordHash: "hash", walletBalance: balance });
  mocks.user.mockResolvedValue({ id, walletBalance: balance });
  return id;
}
function request(body: unknown, origin = "https://pryva.test") {
  return new NextRequest("https://pryva.test/api/demo/wallet/topup", {
    method: "POST", headers: { host: "pryva.test", "x-forwarded-proto": "https", origin, "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("simulated wallet payments", () => {
  it("credits the preview wallet and ledger once for concurrent retries", async () => {
    const id = await createUser();
    const body = { amount: 5000, method: "card", requestId: randomUUID() };
    const [one, two] = await Promise.all([route.POST(request(body)), route.POST(request(body))]);
    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
    const results = await Promise.all([one.json(), two.json()]);
    expect(results.map((result) => result.duplicate).sort()).toEqual([false, true]);
    expect(results[0]).toMatchObject({ ok: true, simulated: true, amount: 5000, fee: 0 });
    expect(results[0].reference).toBe(results[1].reference);
    expect((await database.db.query.users.findFirst({ where: eq(schema.users.id, id) }))?.walletBalance).toBe(6000);
    const ledger = await database.db.query.walletTransactions.findMany({ where: eq(schema.walletTransactions.userId, id) });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ type: "credit", amount: 5000, balanceAfter: 6000 });
    expect((await route.POST(request({ ...body, amount: 6000 }))).status).toBe(409);
    expect((await route.POST(request({ ...body, method: "bank-transfer" }))).status).toBe(409);
  });

  it("requires a valid same-origin request, safe amount and idempotency key", async () => {
    await createUser();
    const body = { amount: 2000, method: "bank-transfer", requestId: randomUUID() };
    expect((await route.POST(request(body, "https://evil.test"))).status).toBe(403);
    for (const invalid of [0, 999, 500001, 1.5, "5000"]) expect((await route.POST(request({ ...body, amount: invalid }))).status).toBe(400);
    expect((await route.POST(request({ ...body, requestId: "bad" }))).status).toBe(400);
    expect((await route.POST(request({ ...body, method: "cash" }))).status).toBe(400);
  });

  it("cannot credit a persistent database and rejects overflow", async () => {
    await createUser(2_147_483_000);
    const body = { amount: 1000, method: "card", requestId: randomUUID() };
    expect((await route.POST(request(body))).status).toBe(409);
    vi.stubEnv("DATABASE_URL", "postgres://persistent.test/db");
    expect((await route.POST(request(body))).status).toBe(404);
  });

  it("labels the checkout as simulated instead of promising a real gateway", () => {
    const html = renderToStaticMarkup(<TopUpForm balance={25000} userId="demo-user" preview />);
    expect(html).toContain("Continue to demo payment");
    expect(html).toContain("No personal payment details or real money");
    expect(html).not.toContain("Pay securely through Paystack");
  });

  it("keeps live top-ups on Paystack rather than demo checkout", () => {
    const html = renderToStaticMarkup(<TopUpForm balance={25000} userId="live-user" />);
    expect(html).toContain("pay securely on Paystack");
    expect(html).toContain("Review a top-up");
    expect(html).toContain("credited only after payment is confirmed");
    expect(html).not.toContain("Continue to demo payment");
  });
});
