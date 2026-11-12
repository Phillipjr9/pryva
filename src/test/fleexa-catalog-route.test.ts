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
  esimAllItems: vi.fn(),
  otpRead: vi.fn(),
  otpItems: vi.fn(),
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
vi.mock("@/lib/services/numbers/otp-suppliers", () => ({ readOtpOffersForSupplier: state.otpRead }));
vi.mock("@/lib/services/numbers/otp-catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/numbers/otp-catalog")>();
  return { ...actual, bitcallOtpItemsForCountry: state.otpItems };
});
vi.mock("@/lib/services/esim/esim-catalog", () => ({ readEsimCatalog: state.esimSnapshot, esimItemsForCountry: state.esimItems, esimItemsForAllDestinations: state.esimAllItems, ESIM_CATALOGUE_LIMIT: 1000 }));

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
  state.esimAllItems.mockReturnValue([ESIM]);
  state.otpRead.mockResolvedValue({ offers: [], errorCode: null });
  state.otpItems.mockReturnValue([]);
});

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("supplier catalog endpoint", () => {
  it("offers a bounded all-destinations eSIM view without contacting unrelated feeds", async () => {
    state.bitcallConfigured = true;
    const listings = Array.from({ length: 1001 }, (_, index) => ({ id: `plan-${index}` }));
    state.esimSnapshot.mockResolvedValue({ partial: false, fetchedAt: "2026-01-03T00:00:00Z", listings });
    const response = await GET(new NextRequest("https://pryva.test/api/services/catalog?country=us&feed=esim&allDestinations=1"));
    expect(await response.json()).toMatchObject({ live: true, partial: true, truncated: true, items: [ESIM] });
    expect(state.esimAllItems).toHaveBeenCalledWith(listings);
    expect(state.esimItems).not.toHaveBeenCalled();
    expect(state.snapshot).not.toHaveBeenCalled();
    expect((await GET(new NextRequest("https://pryva.test/api/services/catalog?country=us&feed=social&allDestinations=1"))).status).toBe(400);
  });
  it("includes the rental and inbox feed when numbers are loaded independently", async () => {
    const body = await (await GET(new NextRequest("https://pryva.test/api/services/catalog?country=us&feed=numbers"))).json();
    expect(state.snapshot).toHaveBeenCalled();
    expect(state.items).toHaveBeenCalled();
    expect(body.items).toContainEqual(SIGNAL);
    expect(state.boostSnapshot).not.toHaveBeenCalled();
    expect(state.esimSnapshot).not.toHaveBeenCalled();
  });
  it("reports unreadable eSIM rows instead of treating them as an empty catalogue", async () => {
    state.bitcallConfigured = true;
    state.esimSnapshot.mockResolvedValue({ partial: false, fetchedAt: "2026-01-03T00:00:00Z", listings: [], stats: { returned: 4 } });
    const response = await GET(new NextRequest("https://pryva.test/api/services/catalog?country=us&feed=esim&allDestinations=1"));
    expect(await response.json()).toMatchObject({ partial: true, unreadable: true });
  });
  it("loads only the requested feed and rejects unknown feeds", async () => {
    state.fleexaConfigured = true; state.boostConfigured = true; state.bitcallConfigured = true;
    // A hung unrelated feed must not block the requested feed or be invoked.
    state.otpRead.mockImplementation(() => new Promise(() => {}));
    const response = await GET(new NextRequest("https://pryva.test/api/services/catalog?country=us&feed=social"));
    expect(await response.json()).toMatchObject({ live: true, partial: false, items: [BOOST] });
    expect(state.limit).toHaveBeenCalledTimes(1);
    expect(state.limit).toHaveBeenCalledWith("supplier-catalog:buyer:social");
    expect(state.boostSnapshot).toHaveBeenCalledOnce();
    expect(state.snapshot).not.toHaveBeenCalled();
    expect(state.esimSnapshot).not.toHaveBeenCalled();
    expect(state.otpRead).not.toHaveBeenCalled();
    expect((await GET(new NextRequest("https://pryva.test/api/services/catalog?country=us&feed=unknown"))).status).toBe(400);
  });

  it("sends a cooldown when a live catalogue feed is throttled", async () => {
    const now = Date.now();
    state.limit.mockResolvedValue({ allowed: false, resetTime: now + 45_000 });
    const response = await GET(new NextRequest("https://pryva.test/api/services/catalog?country=us&feed=numbers"));
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThanOrEqual(44);
    expect(state.snapshot).not.toHaveBeenCalled();
  });

  it("charges a combined request against all feed budgets and fails closed if any is exhausted", async () => {
    state.limit.mockImplementation(async (key: string) => ({ allowed: !key.endsWith(":verification") }));
    expect((await GET(request())).status).toBe(429);
    expect(state.limit.mock.calls.map(([key]) => key).sort()).toEqual([
      "supplier-catalog:buyer:esim", "supplier-catalog:buyer:numbers", "supplier-catalog:buyer:social", "supplier-catalog:buyer:verification",
    ]);
    expect(state.snapshot).not.toHaveBeenCalled();
    expect(state.otpRead).not.toHaveBeenCalled();
  });

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
    state.limit.mockResolvedValueOnce({ allowed: false, unavailable: true });
    const down = await GET(request());
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({ reason: "unavailable" });
    state.limit.mockResolvedValueOnce({ allowed: false });
    const throttled = await GET(request());
    expect(throttled.status).toBe(429);
    // The hub shows different copy for a throttle than for an outage.
    expect(await throttled.json()).toMatchObject({ reason: "throttled" });
    expect(state.limit).toHaveBeenCalledWith("supplier-catalog:buyer:numbers");
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

  it("times out a slow supplier instead of stalling the whole catalog", async () => {
    state.snapshot.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    const pending = GET(request());
    await vi.advanceTimersByTimeAsync(15_001);
    const response = await pending;
    vi.useRealTimers();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "The live catalog is temporarily unavailable", reason: "unavailable" });
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
    expect(body).toMatchObject({ ok: true, live: true, partial: false, items: [ESIM] });
    expect(Number.isFinite(Date.parse(body.fetchedAt))).toBe(true);
  });

  it("is unavailable only when every configured supplier fails", async () => {
    state.boostConfigured = true; state.bitcallConfigured = true;
    state.snapshot.mockRejectedValue(new Error("Supplier catalog unavailable"));
    state.boostSnapshot.mockRejectedValue(new Error("Boosting catalog unavailable"));
    state.esimSnapshot.mockRejectedValue(new Error("eSIM catalog unavailable"));
    state.otpRead.mockResolvedValue({ offers: [], errorCode: "UPSTREAM_ERROR" });
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
    state.otpRead.mockResolvedValue({ offers: [], errorCode: "INSUFFICIENT_BALANCE" });

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
    expect(state.otpRead).toHaveBeenCalledWith("bitcall", "us", expect.any(String), undefined, true);
  });
});

it("does not let an unavailable verification feed degrade number plans", async () => {
  state.fleexaConfigured = true;
  state.bitcallConfigured = true;
  state.otpRead.mockRejectedValue(new Error("Verification unavailable"));
  const response = await GET(new NextRequest("https://pryva.test/api/services/catalog?country=us&feed=numbers"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, partial: false });
  expect(state.otpRead).not.toHaveBeenCalled();
  expect(state.snapshot).toHaveBeenCalledTimes(1);
});
