import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  preview: false,
  user: { id: "buyer" } as { id: string } | null,
  limit: vi.fn(),
  snapshot: vi.fn(),
  items: vi.fn(),
  boostSnapshot: vi.fn(),
  boostItems: vi.fn(),
  esimSnapshot: vi.fn(),
  esimItems: vi.fn(),
  fleexaConfigured: true,
  boostConfigured: false,
  bitcallConfigured: false,
}));
vi.mock("@/lib/demo-policy", () => ({ isPreviewDatabase: () => state.preview }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/lib/rate-limit", () => ({ purchaseRateLimiter: state.limit }));
vi.mock("@/lib/fleexa-catalog", () => ({ readSupplierSnapshot: state.snapshot, supplierItemsForCountry: state.items }));
// Mocked so the real clients never load: each calls createRateLimiter at import
// scope, which this file's narrow rate-limit mock does not provide.
vi.mock("@/lib/fleexa", () => ({ isFleexaConfigured: () => state.fleexaConfigured }));
vi.mock("@/lib/smm-panel", () => ({ isSmmPanelConfigured: () => state.boostConfigured }));
vi.mock("@/lib/smm-catalog", () => ({ readBoostSnapshot: state.boostSnapshot, boostItems: state.boostItems }));
vi.mock("@/lib/bitcall", () => ({ isBitcallConfigured: () => state.bitcallConfigured }));
vi.mock("@/lib/bitcall-esim-catalog", () => ({ readEsimSnapshot: state.esimSnapshot, esimItemsForCountry: state.esimItems }));

import { GET } from "@/app/api/services/catalog/route";

function request(country = "us") { return new NextRequest(`https://pryva.test/api/services/catalog?country=${country}`); }

const SIGNAL = { id: "live-sms-abcdef", name: "Signal", price: 1250, stock: 2, myUnits: null, action: null, source: "live" };
const BOOST = { id: "live-boost-abcdef", name: "Instagram Followers", price: null, stock: null, myUnits: null, action: null, source: "live" };
const ESIM = { id: "live-esim-abcdef", name: "eSIM data plan", price: null, stock: null, myUnits: null, action: null, source: "live" };

beforeEach(() => {
  vi.clearAllMocks();
  state.preview = false; state.user = { id: "buyer" };
  state.fleexaConfigured = true; state.boostConfigured = false; state.bitcallConfigured = false;
  state.limit.mockResolvedValue({ allowed: true });
  state.snapshot.mockResolvedValue({ partial: false, fetchedAt: "2026-01-01T00:00:00Z", privateUpstream: "never exposed" });
  state.items.mockReturnValue([SIGNAL]);
  state.boostSnapshot.mockResolvedValue({ partial: false, fetchedAt: "2026-01-02T00:00:00Z", currency: "USD", balance: 12.5 });
  state.boostItems.mockReturnValue([BOOST]);
  state.esimSnapshot.mockResolvedValue({ partial: false, fetchedAt: "2026-01-03T00:00:00Z", countries: ["Nigeria"] });
  state.esimItems.mockReturnValue([ESIM]);
});

describe("supplier catalog endpoint", () => {
  it("never reaches the provider from the public preview or without authentication", async () => {
    state.preview = true;
    expect((await GET(request())).status).toBe(404);
    state.preview = false; state.user = null;
    expect((await GET(request())).status).toBe(401);
    expect(state.snapshot).not.toHaveBeenCalled();
    expect(state.boostSnapshot).not.toHaveBeenCalled();
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

  it("does not read an unconfigured supplier, and does not call that partial", async () => {
    const body = await (await GET(request())).json();
    expect(state.boostSnapshot).not.toHaveBeenCalled();
    expect(body).toMatchObject({ ok: true, partial: false, items: [SIGNAL] });
  });

  it("serves boosting listings on their own when no other supplier is configured", async () => {
    state.fleexaConfigured = false; state.boostConfigured = true;
    const response = await GET(request());
    const body = await response.json();
    expect(state.snapshot).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    // A single configured supplier is the steady state, not a degraded read.
    expect(body).toMatchObject({ ok: true, partial: false, fetchedAt: "2026-01-02T00:00:00Z", items: [BOOST] });
  });

  it("merges both suppliers and reports the later fetch time", async () => {
    state.boostConfigured = true;
    const body = await (await GET(request())).json();
    expect(body).toMatchObject({ ok: true, partial: false, fetchedAt: "2026-01-02T00:00:00Z", items: [SIGNAL, BOOST] });
  });

  it("degrades to a partial catalog when one configured supplier fails", async () => {
    state.boostConfigured = true;
    state.boostSnapshot.mockRejectedValue(new Error("Boosting catalog unavailable"));
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, partial: true, items: [SIGNAL] });
  });

  it("serves eSIM listings on their own when no other supplier is configured", async () => {
    state.fleexaConfigured = false; state.bitcallConfigured = true;
    const response = await GET(request());
    const body = await response.json();
    expect(state.snapshot).not.toHaveBeenCalled();
    expect(state.boostSnapshot).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, partial: false, fetchedAt: "2026-01-03T00:00:00Z", items: [ESIM] });
  });

  it("is unavailable only when every configured supplier fails", async () => {
    state.boostConfigured = true; state.bitcallConfigured = true;
    state.snapshot.mockRejectedValue(new Error("Supplier catalog unavailable"));
    state.boostSnapshot.mockRejectedValue(new Error("Boosting catalog unavailable"));
    state.esimSnapshot.mockRejectedValue(new Error("eSIM catalog unavailable"));
    expect((await GET(request())).status).toBe(503);

    // With nothing configured at all there is no catalog to serve either.
    state.fleexaConfigured = false; state.boostConfigured = false; state.bitcallConfigured = false;
    expect((await GET(request())).status).toBe(503);
  });

  it("passes the refresh flag through to every configured supplier", async () => {
    state.boostConfigured = true; state.bitcallConfigured = true;
    await GET(new NextRequest("https://pryva.test/api/services/catalog?country=us&refresh=1"));
    expect(state.snapshot).toHaveBeenCalledWith(true);
    expect(state.boostSnapshot).toHaveBeenCalledWith(true);
    expect(state.esimSnapshot).toHaveBeenCalledWith(true);
  });
});
