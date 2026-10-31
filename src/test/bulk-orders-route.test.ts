import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Bulk checkout must buy what it charges for.
 *
 * The route previously wrote every unit as `delivered` with provider `manual`
 * and no fulfilment call: the wallet was debited, nothing was bought, and the
 * order did not even appear in the hand-fulfilment queue. These tests pin the
 * order of operations — fulfil, then record and charge — and the release that
 * has to happen when a later step fails.
 */

const state = vi.hoisted(() => ({
  user: { id: "u1", email: "user@example.com", walletBalance: 50000 } as { id: string; email: string; walletBalance: number } | null,
  sameOrigin: true,
  balance: 50000,
  fulfillable: new Set(["vn-ng", "vn-us", "rent-ng-30"]),
  fulfilError: null as Error | null,
  failOnCall: 0 as number, // 0 = never; n = fail the nth fulfilment attempt
  calls: [] as string[],
  inserts: [] as any[],
  released: [] as any[],
  debits: [] as any[],
  txError: null as Error | null,
  balanceAfter: 49000,
}));

vi.mock("@/lib/auth", () => ({ requireAuthApi: async () => state.user }));

vi.mock("@/lib/net", () => ({ isSameOriginMutation: () => state.sameOrigin }));

vi.mock("@/lib/rate-limit", () => ({
  purchaseRateLimiter: async () => ({ allowed: true, unavailable: false }),
}));

vi.mock("@/lib/schedule-wallet-emails", () => ({ scheduleWalletEmails: vi.fn() }));

vi.mock("@/lib/fleexa", () => ({
  FleexaError: class FleexaError extends Error {
    code: string;
    constructor(message: string, _status: number, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock("@/lib/fulfillment", () => ({
  isPlanFulfillable: (slug: string) => state.fulfillable.has(slug),
  fulfillPlan: async (plan: { slug: string; price: number }) => {
    state.calls.push(plan.slug);
    if (state.failOnCall && state.calls.length >= state.failOnCall) {
      throw state.fulfilError ?? new Error("provider down");
    }
    return {
      provider: "fleexa",
      providerCostNgn: Math.max(0, plan.price - 100),
      providerRequestId: `req-${plan.slug}-${state.calls.length}`,
      referenceCode: `+234800000${state.calls.length}`,
      otpCode: null,
      expiresAt: new Date(Date.now() + 600_000),
    };
  },
  cancelUpstream: async (order: unknown) => {
    state.released.push(order);
    return true;
  },
}));

vi.mock("@/lib/wallet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wallet")>();
  return {
    ...actual,
    debitWalletInTx: async (_tx: unknown, entry: unknown) => {
      state.debits.push(entry);
      return state.balanceAfter;
    },
  };
});

function chain(result: unknown) {
  const api: Record<string, unknown> = {
    from: () => api,
    where: () => api,
    limit: () => Promise.resolve(result),
    values: (value: unknown) => {
      state.inserts.push(value);
      return Promise.resolve();
    },
    set: () => ({ where: () => Promise.resolve() }),
  };
  return api;
}

vi.mock("@/db", () => ({
  db: {
    select: () => chain([{ walletBalance: state.balance }]),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      if (state.txError) throw state.txError;
      const tx = {
        select: () => chain([{ walletBalance: state.balance }]),
        insert: () => chain(null),
        update: () => chain(null),
      };
      return callback(tx);
    },
  },
}));

const { POST } = await import("@/app/api/orders/bulk/route");

function jsonRequest(body: unknown, origin = "https://pryva.test") {
  return new NextRequest("https://pryva.test/api/orders/bulk", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.user = { id: "u1", email: "user@example.com", walletBalance: 50000 };
  state.sameOrigin = true;
  state.balance = 50000;
  state.fulfilError = null;
  state.failOnCall = 0;
  state.calls = [];
  state.inserts = [];
  state.released = [];
  state.debits = [];
  state.txError = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/orders/bulk", () => {
  it("rejects unauthenticated and cross-origin requests", async () => {
    state.user = null;
    expect((await POST(jsonRequest({ items: [{ productSlug: "vn-ng", quantity: 1 }] }))).status).toBe(401);
    state.user = { id: "u1", email: "user@example.com", walletBalance: 50000 };
    state.sameOrigin = false;
    expect((await POST(jsonRequest({ items: [{ productSlug: "vn-ng", quantity: 1 }] }))).status).toBe(403);
  });

  it("rejects empty, invalid and oversized baskets", async () => {
    expect((await POST(jsonRequest({ items: [] }))).status).toBe(400);
    expect((await POST(jsonRequest({ items: [{ productSlug: "nope", quantity: 1 }] }))).status).toBe(400);
    expect((await POST(jsonRequest({ items: [{ productSlug: "vn-ng", quantity: -1 }] }))).status).toBe(400);
    // 21 units is over the per-checkout ceiling, so no supplier call is made.
    expect((await POST(jsonRequest({ items: [{ productSlug: "vn-ng", quantity: 21 }] }))).status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });

  it("refuses a plan with no supplier path instead of charging for it", async () => {
    const response = await POST(jsonRequest({ items: [{ productSlug: "proxy-ng-1", quantity: 2 }] }));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("cannot be delivered automatically");
    expect(state.calls).toHaveLength(0);
    expect(state.debits).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });

  it("refuses a basket the wallet cannot cover before buying anything", async () => {
    state.balance = 100;
    const response = await POST(jsonRequest({ items: [{ productSlug: "vn-ng", quantity: 2 }] }));
    expect(response.status).toBe(402);
    expect(state.calls).toHaveLength(0);
  });

  it("buys every unit, then records delivered orders and charges once", async () => {
    const response = await POST(jsonRequest({
      items: [
        { productSlug: "vn-ng", quantity: 2 },
        { productSlug: "vn-us", quantity: 1 },
      ],
    }));

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.count).toBe(3);
    expect(state.calls).toEqual(["vn-ng", "vn-ng", "vn-us"]);

    // Three real orders, each carrying the provider's own identifiers.
    expect(state.inserts).toHaveLength(3);
    for (const order of state.inserts) {
      expect(order.status).toBe("active");
      expect(order.provider).toBe("fleexa");
      expect(order.providerRequestId).toMatch(/^req-/);
      expect(order.referenceCode).toMatch(/^\+234/);
      expect(order.providerCostNgn).toBeTypeOf("number");
    }

    // One debit for the whole basket, not one per item.
    expect(state.debits).toHaveLength(1);
    expect(state.debits[0].amount).toBeGreaterThan(0);
  });

  it("charges nothing and releases what was already bought when a supplier refuses a unit", async () => {
    state.failOnCall = 2;
    const response = await POST(jsonRequest({ items: [{ productSlug: "vn-ng", quantity: 3 }] }));

    expect(response.status).toBe(502);
    const data = await response.json();
    expect(data.error).toMatch(/nothing was charged/i);
    expect(state.released).toHaveLength(1);
    expect(state.released[0].providerRequestId).toMatch(/^req-/);
    expect(state.inserts).toHaveLength(0);
    expect(state.debits).toHaveLength(0);
  });

  it("releases bought units when recording the order fails", async () => {
    state.txError = new Error("database went away");
    const response = await POST(jsonRequest({ items: [{ productSlug: "vn-ng", quantity: 2 }] }));

    expect(response.status).toBe(500);
    expect(state.released).toHaveLength(2);
    expect(state.debits).toHaveLength(0);
  });
});
