import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  user: { id: "u1", email: "user@example.com", walletBalance: 50000 } as { id: string; email: string; walletBalance: number } | null,
  sameOrigin: true,
  preview: true,
  mockOrders: [] as any[],
  mockTx: [] as any[],
}));

vi.mock("@/lib/auth", () => ({
  requireAuthApi: async () => state.user,
}));

vi.mock("@/lib/net", () => ({
  isSameOriginMutation: () => state.sameOrigin,
}));

vi.mock("@/lib/demo-policy", () => ({
  isPreviewDatabase: () => state.preview,
}));

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
  },
  mutatePreviewDatabase: (cb: (draft: any) => any) => {
    const draft = {
      users: state.user ? [{ id: state.user.id, walletBalance: state.user.walletBalance }] : [],
      orders: state.mockOrders,
      walletTransactions: state.mockTx,
    };
    const res = cb(draft);
    if (state.user) {
      state.user.walletBalance = draft.users[0]?.walletBalance ?? 0;
    }
    return res;
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  purchaseRateLimiter: async () => ({ allowed: true, unavailable: false }),
}));

vi.mock("@/lib/schedule-wallet-emails", () => ({
  scheduleWalletEmails: vi.fn(),
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
  state.preview = true;
  state.mockOrders = [];
  state.mockTx = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/orders/bulk", () => {
  it("rejects unauthenticated requests", async () => {
    state.user = null;
    const res = await POST(jsonRequest({ items: [{ productSlug: "vn-ng", quantity: 2 }] }));
    expect(res.status).toBe(401);
  });

  it("rejects cross-origin requests", async () => {
    state.sameOrigin = false;
    const res = await POST(jsonRequest({ items: [{ productSlug: "vn-ng", quantity: 2 }] }));
    expect(res.status).toBe(403);
  });

  it("rejects empty or invalid items", async () => {
    const resEmpty = await POST(jsonRequest({ items: [] }));
    expect(resEmpty.status).toBe(400);

    const resInvalid = await POST(jsonRequest({ items: [{ productSlug: "invalid-plan", quantity: 1 }] }));
    expect(resInvalid.status).toBe(400);

    const resNegative = await POST(jsonRequest({ items: [{ productSlug: "vn-ng", quantity: -1 }] }));
    expect(resNegative.status).toBe(400);
  });

  it("completes a bulk purchase in preview mode", async () => {
    const res = await POST(jsonRequest({
      items: [
        { productSlug: "vn-ng", quantity: 2 },
        { productSlug: "vn-us", quantity: 1 },
      ],
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.count).toBe(3);
    expect(state.mockOrders).toHaveLength(3);
    expect(state.user?.walletBalance).toBeLessThan(50000);
  });

  it("rejects when wallet balance is insufficient", async () => {
    if (state.user) state.user.walletBalance = 10;
    const res = await POST(jsonRequest({ items: [{ productSlug: "vn-ng", quantity: 5 }] }));
    expect(res.status).toBe(402);
  });
});
