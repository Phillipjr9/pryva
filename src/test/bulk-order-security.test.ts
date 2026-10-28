import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ debit: vi.fn(), credit: vi.fn(), user: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/auth", () => ({ requireAuthApi: mocks.user }));
vi.mock("@/lib/rate-limit", () => ({ purchaseRateLimiter: async () => ({ allowed: true, resetTime: Date.now() + 1000 }) }));
vi.mock("@/lib/wallet", () => ({
  InsufficientFundsError: class extends Error {}, debitWallet: mocks.debit, creditWallet: mocks.credit, makeReference: () => "ref",
}));

import { POST } from "@/app/api/orders/bulk/route";

function request(items: unknown, origin = "https://pryva.test") {
  return new NextRequest("https://pryva.test/api/orders/bulk", {
    method: "POST", headers: { host: "pryva.test", "x-forwarded-proto": "https", origin, "content-type": "application/json" },
    body: JSON.stringify({ items }),
  });
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  mocks.user.mockResolvedValue({ id: "user-1" });
});
afterEach(() => vi.unstubAllEnvs());

describe("bulk basket validation", () => {
  it("rejects negative, zero, fractional, unknown and oversized lines before debit", async () => {
    for (const item of [
      { productSlug: "vn-ng", quantity: -1 },
      { productSlug: "vn-ng", quantity: 0 },
      { productSlug: "vn-ng", quantity: 1.5 },
      { productSlug: "nonexistent", quantity: 10 },
      { productSlug: "vn-ng", quantity: 201 },
    ]) {
      // Pair with a valid line so a negative or invalid line cannot merely be
      // hidden in an otherwise positive basket or inflate its discount tier.
      expect((await POST(request([{ productSlug: "vn-ng", quantity: 10 }, item]))).status).toBe(400);
    }
    expect(mocks.debit).not.toHaveBeenCalled();
  });
  it("rejects cross-origin requests and persistent-database purchases", async () => {
    expect((await POST(request([{ productSlug: "vn-ng", quantity: 1 }], "https://evil.pryva.test"))).status).toBe(403);
    vi.stubEnv("DATABASE_URL", "postgres://live-test/db");
    expect((await POST(request([{ productSlug: "vn-ng", quantity: 1 }]))).status).toBe(503);
    expect(mocks.debit).not.toHaveBeenCalled();
  });
});
