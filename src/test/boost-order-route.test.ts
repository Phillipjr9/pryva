import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The guard rails in front of a boost purchase, in the order a request meets
 * them. Everything here spends wallet money, so each refusal is checked for the
 * status the client acts on and for whether the order was attempted at all.
 */

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  limit: vi.fn(),
  velocity: vi.fn(),
  fraud: vi.fn(),
  place: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/fraud", () => ({ purchaseVelocity: mocks.velocity, recordFraudEvent: mocks.fraud }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, purchaseRateLimiter: mocks.limit };
});
vi.mock("@/lib/boost-orders", () => ({ placeBoostOrder: mocks.place }));

import { POST } from "@/app/api/boosts/order/route";

const ITEM = "live-boost-0123456789abcdef0123";
const REQUEST = "22222222-2222-4222-8222-222222222222";

function post(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("https://pryva.test/api/boosts/order", {
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

const valid = { itemId: ITEM, link: "https://instagram.com/ada", quantity: 1_000, requestId: REQUEST };

const ORDER = {
  id: "order-1",
  reference: "PRY-BOOST1",
  productName: "Instagram Followers",
  planLabel: "1,000 followers",
  amount: 1_500,
  status: "active",
  targetLink: "https://instagram.com/ada",
  quantity: 1_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "user-1", email: "buyer@pryva.ng" });
  mocks.limit.mockResolvedValue({ allowed: true, unavailable: false });
  mocks.velocity.mockResolvedValue({ allowed: true, count: 1, limit: 20 });
  mocks.place.mockResolvedValue({ kind: "created", order: ORDER, balance: 23_500 });
});

describe("POST /api/boosts/order", () => {
  it("requires a session, same origin and JSON", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await POST(post(valid))).status).toBe(401);

    expect((await POST(post(valid, { origin: "https://evil.test" }))).status).toBe(403);
    expect((await POST(post(valid, { "content-type": "text/plain" }))).status).toBe(415);
    expect(mocks.place).not.toHaveBeenCalled();
  });

  it("fails closed when the limiter is down and refuses a flood", async () => {
    mocks.limit.mockResolvedValueOnce({ allowed: false, unavailable: true });
    expect((await POST(post(valid))).status).toBe(503);

    mocks.limit.mockResolvedValueOnce({ allowed: false, unavailable: false });
    expect((await POST(post(valid))).status).toBe(429);
    expect(mocks.place).not.toHaveBeenCalled();
  });

  it("stops an order flood before it reaches the supplier", async () => {
    mocks.velocity.mockResolvedValueOnce({ allowed: false, count: 40, limit: 20 });
    const response = await POST(post(valid));
    expect(response.status).toBe(429);
    expect(mocks.fraud).toHaveBeenCalledOnce();
    expect(mocks.place).not.toHaveBeenCalled();
  });

  it("rejects a malformed request before charging anything", async () => {
    for (const body of [
      { ...valid, itemId: "svc-101" },
      { ...valid, itemId: "live-boost-ZZZZ" },
      { ...valid, link: "ftp://instagram.com/ada" },
      { ...valid, link: "" },
      { ...valid, quantity: 0 },
      { ...valid, quantity: 1.5 },
      { ...valid, quantity: "1000" },
      { ...valid, requestId: "not-a-uuid" },
      { ...valid, requestId: undefined },
      [1, 2, 3],
      "not json at all",
    ]) {
      const response = await POST(post(body));
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(mocks.place).not.toHaveBeenCalled();
  });

  it("tells the buyer the shortfall instead of placing the order", async () => {
    mocks.place.mockResolvedValueOnce({ kind: "insufficient", balance: 500, required: 1_500 });
    const response = await POST(post(valid));
    expect(response.status).toBe(402);
    const data = (await response.json()) as { ok: boolean; error: string; balance: number };
    expect(data.ok).toBe(false);
    expect(data.error).toContain("500");
    expect(data.balance).toBe(500);
  });

  it("says boosting is unavailable when nothing is configured, rather than failing with a 500", async () => {
    mocks.place.mockResolvedValueOnce({ kind: "disabled", error: "Boosting is not available right now. Nothing was charged." });
    const response = await POST(post(valid));
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: string }).error).toContain("Nothing was charged");
  });

  it("reports an unavailable service as unavailable, not as a success", async () => {
    mocks.place.mockResolvedValueOnce({ kind: "unavailable", error: "That boost is not available right now." });
    const response = await POST(post(valid));
    expect(response.status).toBe(502);
    expect(((await response.json()) as { ok: boolean }).ok).toBe(false);
  });

  it("returns the placed order and the new balance", async () => {
    const response = await POST(post(valid));
    expect(response.status).toBe(200);
    const data = (await response.json()) as {
      ok: boolean; replayed: boolean; balance?: number;
      order: { reference: string; amount: number; quantity: number; targetLink: string };
    };
    expect(data).toMatchObject({ ok: true, replayed: false, balance: 23_500 });
    expect(data.order).toMatchObject({ reference: "PRY-BOOST1", amount: 1_500, quantity: 1_000 });
    expect(mocks.place).toHaveBeenCalledWith({
      userId: "user-1", itemId: ITEM, link: "https://instagram.com/ada", quantity: 1_000, requestId: REQUEST,
    });
  });

  it("flags a replay so the interface never implies a second charge", async () => {
    mocks.place.mockResolvedValueOnce({ kind: "replay", order: ORDER });
    const response = await POST(post({ ...valid, requestId: REQUEST.toUpperCase().replace("22222222", "22222222") }));
    const data = (await response.json()) as { replayed: boolean; balance?: number };
    expect(data.replayed).toBe(true);
    expect(data.balance).toBeUndefined();
  });

  it("never leaks an internal failure as a stack trace", async () => {
    mocks.place.mockRejectedValueOnce(new Error("connect ECONNREFUSED 10.0.0.4:5432"));
    const response = await POST(post(valid));
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("10.0.0.4");
  });
});
