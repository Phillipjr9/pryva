import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("@/lib/platform/demo-policy", () => ({ isPreviewDatabase: () => state.preview }));
vi.mock("@/lib/identity/auth", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/lib/platform/rate-limit", async (importOriginal) => {
  // Keep the real module: other limiters are constructed when a route imports
  // a money module, and a factory that omits them fails at import time.
  const actual = await importOriginal<typeof import("@/lib/platform/rate-limit")>();
  // The catalogue reads through its own bucket: browsing must not spend the
  // budget that purchases depend on, and vice versa.
  return { ...actual, catalogRateLimiter: state.limit };
});
vi.mock("@/lib/services/numbers/fleexa-catalog", () => ({ readSupplierSnapshot: state.snapshot, supplierItemsForCountry: state.items }));
// Mocked so the real clients never load: each calls createRateLimiter at import
// scope, which this file's narrow rate-limit mock does not provide.
vi.mock("@/lib/providers/fleexa", () => ({ isFleexaConfigured: () => state.fleexaConfigured }));
vi.mock("@/lib/providers/smm-panel", () => ({ isSmmPanelConfigured: () => state.boostConfigured }));
vi.mock("@/lib/services/boosts/smm-catalog", () => ({ readBoostSnapshot: state.boostSnapshot, boostItems: state.boostItems }));
vi.mock("@/lib/providers/bitcall", () => ({ isBitcallConfigured: () => state.bitcallConfigured }));
vi.mock("@/lib/services/esim/esim-catalog", () => ({ readEsimCatalog: state.esimSnapshot, esimItemsForCountry: state.esimItems }));

import { ProviderError } from "@/lib/providers/types";

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
  state.esimSnapshot.mockResolvedValue({ partial: false, fetchedAt: "2026-01-03T00:00:00Z", offers: [], listings: [] });
  state.esimItems.mockReturnValue([ESIM]);
});

afterEach(() => vi.unstubAllEnvs());

describe("supplier catalog endpoint", () => {
  it("does not query live catalogues from a Vercel preview with a persistent database", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://mock.invalid/db");
    vi.stubEnv("VERCEL_ENV", "preview");
    const response = await GET(request());
    // Not an error: the environment is closed, so it reports that instead of a
    // retryable failure the hub could only render as breakage.
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, live: false, reason: "environment", partial: false, fetchedAt: null, items: [] });
    expect(state.snapshot).not.toHaveBeenCalled();
    expect(state.boostSnapshot).not.toHaveBeenCalled();
    expect(state.esimSnapshot).not.toHaveBeenCalled();
  });

  it("never reaches the provider from the public preview or without authentication", async () => {
    state.preview = true;
    const preview = await GET(request());
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ ok: true, live: false, reason: "environment", items: [] });
    state.preview = false; state.user = null;
    // Signed out is still a real 401: the customer needs to sign in, not retry.
    expect((await GET(request())).status).toBe(401);
    expect(state.snapshot).not.toHaveBeenCalled();
    expect(state.boostSnapshot).not.toHaveBeenCalled();
    expect(state.esimSnapshot).not.toHaveBeenCalled();
  });

  it("validates country, fails closed on the limiter and keeps the result sanitized", async () => {
    expect((await GET(request("not-real"))).status).toBe(400);
    state.limit.mockResolvedValueOnce({ allowed: false, unavailable: true }).mockResolvedValueOnce({ allowed: false });
    const down = await GET(request());
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({ reason: "unavailable" });
    const throttled = await GET(request());
    expect(throttled.status).toBe(429);
    // The hub shows different copy for a throttle than for an outage.
    expect(await throttled.json()).toMatchObject({ reason: "throttled" });
    expect(state.limit).toHaveBeenCalledWith("supplier-catalog:buyer");
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
    expect(body).toMatchObject({ ok: true, live: true, partial: false, items: [SIGNAL] });
  });

  it("serves boosting listings on their own when no other supplier is configured", async () => {
    state.fleexaConfigured = false; state.boostConfigured = true;
    const response = await GET(request());
    const body = await response.json();
    expect(state.snapshot).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    // A single configured supplier is the steady state, not a degraded read.
    expect(body).toMatchObject({ ok: true, live: true, partial: false, fetchedAt: "2026-01-02T00:00:00Z", items: [BOOST] });
  });

  it("merges both suppliers and reports the later fetch time", async () => {
    state.boostConfigured = true;
    const body = await (await GET(request())).json();
    expect(body).toMatchObject({ ok: true, live: true, partial: false, fetchedAt: "2026-01-02T00:00:00Z", items: [SIGNAL, BOOST] });
  });

  it("degrades to a partial catalog when one configured supplier fails", async () => {
    state.boostConfigured = true;
    state.boostSnapshot.mockRejectedValue(new Error("Boosting catalog unavailable"));
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, live: true, partial: true, reason: "partial", items: [SIGNAL] });
  });

  it("serves eSIM listings on their own when no other supplier is configured", async () => {
    state.fleexaConfigured = false; state.bitcallConfigured = true;
    const response = await GET(request());
    const body = await response.json();
    expect(state.snapshot).not.toHaveBeenCalled();
    expect(state.boostSnapshot).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, live: true, partial: false, fetchedAt: "2026-01-03T00:00:00Z", items: [ESIM] });
  });

  it("is unavailable only when every configured supplier fails", async () => {
    state.boostConfigured = true; state.bitcallConfigured = true;
    state.snapshot.mockRejectedValue(new Error("Supplier catalog unavailable"));
    state.boostSnapshot.mockRejectedValue(new Error("Boosting catalog unavailable"));
    state.esimSnapshot.mockRejectedValue(new Error("eSIM catalog unavailable"));
    expect((await GET(request())).status).toBe(503);

  });

  it("treats a deployment with no supplier connected as a steady state, not an outage", async () => {
    state.fleexaConfigured = false; state.boostConfigured = false; state.bitcallConfigured = false;
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ ok: true, live: false, reason: "unconfigured", partial: false, fetchedAt: null, items: [] });
  });

  it("calls an unfunded balance what it is, instead of an outage to retry", async () => {
    // The customer's suppliers are connected and out of balance. That is a
    // restocking problem: 200 with a reason, so the hub stops offering a Retry
    // that cannot refill an account.
    const unfunded = () => new ProviderError("balance", { provider: "fleexa", status: 402, code: "INSUFFICIENT_BALANCE" });
    state.boostConfigured = true; state.bitcallConfigured = true;
    state.snapshot.mockRejectedValue(unfunded());
    state.boostSnapshot.mockRejectedValue(new ProviderError("balance", { provider: "smm", status: 402, code: "INSUFFICIENT_BALANCE" }));
    state.esimSnapshot.mockRejectedValue(new ProviderError("balance", { provider: "bitcall", status: 402, code: "INSUFFICIENT_BALANCE" }));

    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, live: false, reason: "funding", partial: false, items: [] });
  });

  it("still reports an outage when the failures are not about money", async () => {
    state.boostConfigured = true;
    state.snapshot.mockRejectedValue(new ProviderError("down", { provider: "fleexa", status: 502, code: "UPSTREAM_UNREACHABLE" }));
    state.boostSnapshot.mockRejectedValue(new ProviderError("down", { provider: "smm", status: 502, code: "UPSTREAM_ERROR" }));
    expect((await GET(request())).status).toBe(503);

    // One unfunded source next to one outage is an outage: something may still
    // come back on its own, so retrying stays on the table.
    state.boostSnapshot.mockRejectedValue(new ProviderError("balance", { provider: "smm", status: 402, code: "INSUFFICIENT_BALANCE" }));
    expect((await GET(request())).status).toBe(503);
  });

  it("keeps a funding gap out of the retryable partial path", async () => {
    // Boosting is unfunded, verification is healthy: the catalogue is genuinely
    // incomplete, but the gap is money — so it is labelled funding, and the hub
    // drops the Retry.
    state.boostConfigured = true;
    state.boostSnapshot.mockRejectedValue(new ProviderError("balance", { provider: "smm", status: 402, code: "INSUFFICIENT_BALANCE" }));
    const body = await (await GET(request())).json();
    expect(body).toMatchObject({ ok: true, live: true, partial: true, reason: "funding", items: [SIGNAL] });

    // A degraded read for an ordinary outage keeps the generic partial reason.
    state.boostSnapshot.mockResolvedValue({ partial: true, degraded: "outage", fetchedAt: "2026-01-02T00:00:00Z", currency: null, balance: null });
    expect(await (await GET(request())).json()).toMatchObject({ partial: true, reason: "partial" });
  });

  it("passes the refresh flag through to every configured supplier", async () => {
    state.boostConfigured = true; state.bitcallConfigured = true;
    await GET(new NextRequest("https://pryva.test/api/services/catalog?country=us&refresh=1"));
    expect(state.snapshot).toHaveBeenCalledWith(true);
    expect(state.boostSnapshot).toHaveBeenCalledWith(true);
    expect(state.esimSnapshot).toHaveBeenCalledWith(true);
  });
});
