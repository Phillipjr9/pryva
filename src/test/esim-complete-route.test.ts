import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  preview: false,
  allowed: true,
  unavailable: false,
  result: { kind: "pending" } as { kind: string },
  complete: vi.fn(),
}));
vi.mock("@/lib/identity/auth", () => ({ getCurrentUser: async () => ({ id: "u1" }) }));
vi.mock("@/lib/platform/demo-policy", () => ({ isPreviewDatabase: () => state.preview }));
vi.mock("@/lib/platform/net", () => ({ isSameOriginMutation: () => true }));
vi.mock("@/lib/platform/rate-limit", async (importOriginal) => {
  // Keep the real module: other limiters are constructed when a route imports
  // a money module, and a factory that omits them fails at import time.
  const actual = await importOriginal<typeof import("@/lib/platform/rate-limit")>();
  return { ...actual, purchaseRateLimiter: async () => ({ allowed: state.allowed, unavailable: state.unavailable }) };
});
vi.mock("@/lib/services/esim/esim-fulfilment", () => ({ completeEsimOrder: async (...args: unknown[]) => { state.complete(...args); return state.result; } }));
vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ service: "esim", status: "processing" }] }) }) }) },
}));

const { POST } = await import("@/app/api/esim/orders/[id]/complete/route");
const params = { params: Promise.resolve({ id: "b1a6f0e2-3c4d-4e5f-8a9b-0c1d2e3f4a5b" }) };
const request = () => new NextRequest("https://pryva.test/api/esim/orders/test/complete", { method: "POST" });
beforeEach(() => { state.preview = false; state.allowed = true; state.unavailable = false; state.result = { kind: "pending" }; state.complete.mockReset(); });

describe("eSIM provisioning checks", () => {
  it("does not contact the network from an in-memory preview", async () => {
    state.preview = true;
    expect((await POST(request(), params)).status).toBe(503);
    expect(state.complete).not.toHaveBeenCalled();
  });
  it("fails closed when rate limiting is unavailable", async () => {
    state.unavailable = true;
    expect((await POST(request(), params)).status).toBe(503);
    expect(state.complete).not.toHaveBeenCalled();
  });
  it("directs unpaid review orders to support rather than promising a retry", async () => {
    state.result = { kind: "unpaid" };
    const response = await POST(request(), params);
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.message).toMatch(/contact support/i);
    expect(body.message).not.toMatch(/top up|check again/i);
  });
  it("reports provisioning without exposing where stock comes from", async () => {
    const response = await POST(request(), params);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.delivered).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/supplier|bitcall/i);
    expect(state.complete).toHaveBeenCalledTimes(1);
  });
});
