import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

/**
 * The hand-sourced fulfilment queue.
 *
 * These orders are the ones where money has already moved and the product only
 * exists once an admin pastes credentials in, so the rules that matter are:
 * deliver exactly the number of units the customer paid for, never deliver the
 * same order twice, keep credentials out of the logs, and when an item cannot be
 * sourced move it to `review` so the audited refund path — not this route —
 * decides about the money.
 */

const mocks = vi.hoisted(() => ({ user: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getCurrentUser: mocks.user };
});
vi.mock("@/lib/logger", () => ({ logger: { info: mocks.info, warn: mocks.warn, error: mocks.error } }));

const ADMIN_EMAIL = "owner@pryva.test";
const ORIGIN = "https://pryva.test";
/** Real slug from data/manual-catalog.json, so warranty maths is exercised for real. */
const NETFLIX_SLUG = "p3:netflix-standard";

let database: typeof import("@/db");
let schema: typeof import("@/db/schema");
let route: typeof import("@/app/api/admin/fulfilment/route");
let customerId: string;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("ADMIN_EMAILS", ADMIN_EMAIL);
  [database, schema, route] = await Promise.all([
    import("@/db"), import("@/db/schema"), import("@/app/api/admin/fulfilment/route"),
  ]);
  customerId = randomUUID();
  await database.db.insert(schema.users).values({
    id: customerId, name: "Customer", email: `${customerId}@example.test`, passwordHash: "hash", walletBalance: 0,
  });
});

beforeEach(() => {
  // Verified: administrator access now requires proof of control of the address,
    // because ADMIN_EMAILS matches on the email string alone.
    mocks.user.mockResolvedValue({ id: randomUUID(), name: "Owner", email: ADMIN_EMAIL, emailVerifiedAt: new Date("2026-01-02T00:00:00Z") });
  mocks.info.mockReset(); mocks.warn.mockReset(); mocks.error.mockReset();
});

function headers(json = true): Record<string, string> {
  return {
    origin: ORIGIN, host: "pryva.test", "x-forwarded-proto": "https",
    ...(json ? { "content-type": "application/json" } : {}),
  };
}
const getList = () => new NextRequest(`${ORIGIN}/api/admin/fulfilment`, { headers: headers(false) });
const post = (body: unknown, json = true) => new NextRequest(`${ORIGIN}/api/admin/fulfilment`, {
  method: "POST", headers: headers(json), body: typeof body === "string" ? body : JSON.stringify(body),
});

async function makeOrder(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  await database.db.insert(schema.orders).values({
    id, userId: customerId, reference: `PRYVA-${id.slice(0, 8).toUpperCase()}`, service: "digital",
    productSlug: NETFLIX_SLUG, productName: "Netflix Standard (1080p)", planLabel: "3 × account",
    region: "Global", duration: "120 days", amount: 15000, status: "processing", provider: "manual",
    ...overrides,
  });
  return id;
}

const readOrder = async (id: string) =>
  (await database.db.select().from(schema.orders).where(eq(schema.orders.id, id)).limit(1))[0];

describe("admin fulfilment queue", () => {
  it("lists queued orders with the unit count and warranty, and no sourcing detail", async () => {
    const queued = await makeOrder();
    await makeOrder({ status: "delivered" });
    await makeOrder({ provider: "accounts", productSlug: "p1:SPOTIFY-AGED" });
    await makeOrder({ status: "processing", refundedAt: new Date() });

    const body = await (await route.GET(getList())).json();
    expect(body.ok).toBe(true);
    const ids = body.queue.map((row: { id: string }) => row.id);
    expect(ids).toContain(queued);
    // Delivered, API-sourced and refunded orders are not waiting on an admin.
    expect(ids).toHaveLength(1);

    const row = body.queue[0];
    expect(row.quantity).toBe(3);
    expect(row.warrantyDays).toBe(120);
    expect(row.email).toBe(`${customerId}@example.test`);
    // The slug carries the source token; it must not be handed to the browser.
    const json = JSON.stringify(body).toLowerCase();
    expect(json).not.toContain(NETFLIX_SLUG);
    expect(json).not.toContain("p3:");
    for (const word of ["supplier", "reseller", "wholesale", "bulkacc", "fleexa", "accszone"]) {
      expect(json, `queue leaked "${word}"`).not.toContain(word);
    }
  });

  it("delivers exactly the paid quantity and stamps the warranty deadline", async () => {
    const id = await makeOrder();
    const before = Date.now();
    const credentials = ["user1|pass1", "user2|pass2", "user3|pass3"];

    const response = await route.POST(post({ orderId: id, action: "deliver", credentials }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "delivered", items: 3, warrantyDays: 120 });

    const order = await readOrder(id);
    expect(order.status).toBe("delivered");
    expect(JSON.parse(order.accounts!)).toEqual(credentials);
    // 120 days from now, within the time this test took to run.
    const expiry = order.expiresAt!.getTime();
    expect(expiry - before).toBeGreaterThanOrEqual(120 * 24 * 60 * 60 * 1000 - 5_000);
    expect(expiry - before).toBeLessThanOrEqual(120 * 24 * 60 * 60 * 1000 + 60_000);
  });

  it("refuses a count that does not match what was paid for", async () => {
    const id = await makeOrder({ planLabel: "2 × account" });

    const tooFew = await route.POST(post({ orderId: id, action: "deliver", credentials: ["a|b"] }));
    expect(tooFew.status).toBe(400);
    expect(await tooFew.json()).toEqual({ error: "This order needs exactly 2 credentials." });

    const tooMany = await route.POST(post({ orderId: id, action: "deliver", credentials: ["a|b", "c|d", "e|f"] }));
    expect(tooMany.status).toBe(400);

    // Nothing was written by either attempt. (The preview database omits a
    // column that was never set, so normalise before asserting.)
    const order = await readOrder(id);
    expect(order.status).toBe("processing");
    expect(order.accounts ?? null).toBeNull();
    expect(order.expiresAt ?? null).toBeNull();
  });

  it("rejects unusable credentials instead of storing them", async () => {
    const id = await makeOrder({ planLabel: "1 × account" });
    for (const credentials of [[""], ["   "], ["a\u0000b"], ["x".repeat(2001)], [42], [[]]]) {
      const response = await route.POST(post({ orderId: id, action: "deliver", credentials }));
      expect(response.status, JSON.stringify(credentials).slice(0, 30)).toBe(400);
    }
    expect((await readOrder(id)).status).toBe("processing");
  });

  it("cannot deliver the same order twice", async () => {
    const id = await makeOrder({ planLabel: "1 × account" });
    const first = await route.POST(post({ orderId: id, action: "deliver", credentials: ["a|b"] }));
    expect(first.status).toBe(200);

    const second = await route.POST(post({ orderId: id, action: "deliver", credentials: ["c|d"] }));
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "That order has already been fulfilled or changed" });
    // The first delivery is still what the customer sees.
    expect(JSON.parse((await readOrder(id)).accounts!)).toEqual(["a|b"]);
  });

  it("never writes a credential into the log", async () => {
    const id = await makeOrder({ planLabel: "1 × account" });
    const secret = "secret-login|super-secret-password";
    await route.POST(post({ orderId: id, action: "deliver", credentials: [secret] }));

    const logged = [mocks.info, mocks.warn, mocks.error]
      .flatMap((fn) => fn.mock.calls)
      .map((call) => JSON.stringify(call))
      .join("\n");
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain("super-secret-password");
    // It does record enough to reconcile: which order, how many units.
    expect(mocks.info).toHaveBeenCalledWith("Hand-sourced order delivered", expect.objectContaining({ items: 1 }));
  });

  it("moves an unsourceable order to review and points at the audited refund path", async () => {
    const id = await makeOrder();
    const response = await route.POST(post({ orderId: id, action: "unavailable", reason: "Out of stock everywhere" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, status: "review" });
    expect(body.nextStep).toMatch(/reconciliationConfirmed/);
    expect((await readOrder(id)).status).toBe("review");

    // Review is not a refund: the wallet is untouched until the admin confirms.
    const [user] = await database.db.select().from(schema.users).where(eq(schema.users.id, customerId));
    expect(user.walletBalance).toBe(0);
  });

  it("requires a reason short enough to show a customer", async () => {
    const id = await makeOrder();
    for (const reason of [undefined, "", "   ", "x".repeat(181), 42]) {
      const response = await route.POST(post({ orderId: id, action: "unavailable", reason }));
      expect(response.status, String(reason).slice(0, 20)).toBe(400);
    }
    expect((await readOrder(id)).status).toBe("processing");
  });

  it("validates the request before touching the database", async () => {
    const id = await makeOrder();
    expect((await route.POST(post({ orderId: "not-a-uuid", action: "deliver", credentials: ["a"] }))).status).toBe(400);
    expect((await route.POST(post({ orderId: id, action: "refund", credentials: ["a"] }))).status).toBe(400);
    expect((await route.POST(post({ orderId: id, action: "deliver", credentials: [] }))).status).toBe(400);
    expect((await route.POST(post("not json", false))).status).toBe(415);
    expect((await readOrder(id)).status).toBe("processing");
  });

  it("only ever acts on hand-sourced, unrefunded orders", async () => {
    const apiSourced = await makeOrder({ provider: "accounts", productSlug: "p1:SPOTIFY", planLabel: "1 × account" });
    const refunded = await makeOrder({ planLabel: "1 × account", refundedAt: new Date() });

    for (const orderId of [apiSourced, refunded, randomUUID()]) {
      const response = await route.POST(post({ orderId, action: "deliver", credentials: ["a|b"] }));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "That order is not in the fulfilment queue" });
    }
    expect((await readOrder(apiSourced)).status).toBe("processing");
  });

  it("refuses everyone who is not the configured administrator", async () => {
    const id = await makeOrder({ planLabel: "1 × account" });

    mocks.user.mockResolvedValue(null);
    expect((await route.GET(getList())).status).toBe(401);
    expect((await route.POST(post({ orderId: id, action: "deliver", credentials: ["a|b"] }))).status).toBe(401);

    mocks.user.mockResolvedValue({ id: customerId, name: "Customer", email: `${customerId}@example.test` });
    expect((await route.GET(getList())).status).toBe(403);
    expect((await route.POST(post({ orderId: id, action: "deliver", credentials: ["a|b"] }))).status).toBe(403);

    // A cross-origin mutation is refused even for the administrator.
    // Verified: administrator access now requires proof of control of the address,
    // because ADMIN_EMAILS matches on the email string alone.
    mocks.user.mockResolvedValue({ id: randomUUID(), name: "Owner", email: ADMIN_EMAIL, emailVerifiedAt: new Date("2026-01-02T00:00:00Z") });
    const crossOrigin = new NextRequest(`${ORIGIN}/api/admin/fulfilment`, {
      method: "POST",
      headers: { origin: "https://evil.example", host: "pryva.test", "x-forwarded-proto": "https", "content-type": "application/json" },
      body: JSON.stringify({ orderId: id, action: "deliver", credentials: ["a|b"] }),
    });
    expect((await route.POST(crossOrigin)).status).toBe(403);
    expect((await readOrder(id)).status).toBe("processing");
  });
});
