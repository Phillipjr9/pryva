import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ preview: false, user: { id: "buyer" } as { id: string } | null, limit: vi.fn(), snapshot: vi.fn(), items: vi.fn() }));
vi.mock("@/lib/demo-policy", () => ({ isPreviewDatabase: () => state.preview }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/lib/rate-limit", () => ({ purchaseRateLimiter: state.limit }));
vi.mock("@/lib/fleexa-catalog", () => ({ readSupplierSnapshot: state.snapshot, supplierItemsForCountry: state.items }));

import { GET } from "@/app/api/services/catalog/route";

function request(country = "us") { return new NextRequest(`https://pryva.test/api/services/catalog?country=${country}`); }
beforeEach(() => {
  vi.clearAllMocks(); state.preview = false; state.user = { id: "buyer" };
  state.limit.mockResolvedValue({ allowed: true });
  state.snapshot.mockResolvedValue({ partial: false, fetchedAt: "2026-01-01T00:00:00Z", privateUpstream: "never exposed" });
  state.items.mockReturnValue([{ id: "supplier-sms-abcdef", name: "Signal", price: 1250, stock: 2, myUnits: null, action: null, source: "supplier" }]);
});

describe("supplier catalog endpoint", () => {
  it("never reaches the provider from the public preview or without authentication", async () => {
    state.preview = true;
    expect((await GET(request())).status).toBe(404);
    state.preview = false; state.user = null;
    expect((await GET(request())).status).toBe(401);
    expect(state.snapshot).not.toHaveBeenCalled();
  });

  it("validates country, fails closed on the limiter and keeps the result sanitized", async () => {
    expect((await GET(request("not-real"))).status).toBe(400);
    state.limit.mockResolvedValueOnce({ allowed: false, unavailable: true }).mockResolvedValueOnce({ allowed: false });
    expect((await GET(request())).status).toBe(503);
    expect((await GET(request())).status).toBe(429);
    const response = await GET(request());
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toContain("Signal");
    expect(body).not.toContain("privateUpstream");
  });
});
