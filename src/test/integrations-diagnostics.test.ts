import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  limit: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  manualReachable: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({ createRateLimiter: () => runtime.limit }));
vi.mock("@/lib/logger", () => ({ logger: runtime.log }));
// Separate module because it reaches the database, and `@/lib/auth` pulls in
// `next/headers`. The diagnostics route only needs its answer.
vi.mock("@/lib/manual-fulfilment", () => ({
  isManualFulfilmentReachable: () => runtime.manualReachable(),
}));

import { clearBulkaccCache, probeCatalog } from "@/lib/bulkacc";
import { GET } from "@/app/api/diagnostics/integrations/route";
import { NextRequest } from "next/server";

const API_KEY = "diag-key-WXYZ9876";
const CRON_SECRET = "diag-cron-secret";

/** The supplier's documented logical-failure shape: HTTP 200, data null. */
const NO_BALANCE = { data: null, statusCode: 200, message: "insufficient account balance!" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function request(url = "https://pryva.test/api/diagnostics/integrations", auth?: string) {
  const headers = new Headers();
  if (auth !== undefined) headers.set("authorization", auth);
  return new NextRequest(new URL(url), { headers });
}

/** Route every supplier call by path so one stub can serve several endpoints. */
function stubFetch(routes: { products?: unknown; balance?: unknown; status?: number }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    if (url.pathname.includes("products")) {
      return jsonResponse(routes.products ?? NO_BALANCE, routes.status ?? 200);
    }
    return jsonResponse(routes.balance ?? { data: "0.00", statusCode: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubEnv("BULKACC_API_KEY", API_KEY);
  vi.stubEnv("BULKACC_API_URL", "");
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("DIAGNOSTICS_SECRET", "");
  // Aurora over RDS IAM sets no DATABASE_URL; these four are what the predicate
  // actually asks for. Without them the app classifies itself as preview and
  // refuses marketplace purchasing outright, which would make every assertion
  // below pass for the wrong reason.
  vi.stubEnv("PGHOST", "db.test");
  vi.stubEnv("PGUSER", "pryva");
  vi.stubEnv("AWS_REGION", "us-east-1");
  vi.stubEnv("AWS_ROLE_ARN", "arn:aws:iam::123456789012:role/test");
  runtime.limit.mockResolvedValue({ allowed: true });
  runtime.manualReachable.mockResolvedValue(false);
  clearBulkaccCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearBulkaccCache();
});

describe("catalog probe: an empty feed explains itself", () => {
  it("keeps the reason when the supplier returns HTTP 200 with no data", async () => {
    stubFetch({ products: NO_BALANCE });

    const probe = await probeCatalog();

    // Before this, the message was discarded and the caller saw only `[]`,
    // indistinguishable from a catalog that was genuinely empty.
    expect(probe).toEqual({ state: "no_products", detail: "insufficient account balance!" });
  });

  it("reports a serving catalog with its own product total", async () => {
    stubFetch({
      products: {
        data: { items: [{ code: "300004", name: "Aged account", price: "1.20" }], totalCount: 412, totalPages: 412 },
        statusCode: 200,
        message: "",
      },
    });

    await expect(probeCatalog()).resolves.toEqual({ state: "serving", totalCount: 412 });
  });

  it("reports a rejected credential as a failure with its code, not as an empty catalog", async () => {
    stubFetch({ products: { data: null, statusCode: 401, message: "invalid api key" } });

    await expect(probeCatalog()).resolves.toEqual({
      state: "failed",
      code: "logical_error",
      detail: "invalid api key",
    });
  });

  it("says not_configured rather than calling the network when there is no key", async () => {
    const fetchMock = stubFetch({});
    vi.stubEnv("BULKACC_API_KEY", "");

    await expect(probeCatalog()).resolves.toEqual({ state: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("diagnostics endpoint: gated, and never echoes a credential", () => {
  it("refuses a request that does not carry the secret", async () => {
    const fetchMock = stubFetch({});

    const noHeader = await GET(request());
    const wrongHeader = await GET(request("https://pryva.test/x", `Bearer ${CRON_SECRET}x`));

    expect(noHeader.status).toBe(401);
    expect(wrongHeader.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses everything when no secret is configured, so the route cannot be opened by accident", async () => {
    stubFetch({});
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("DIAGNOSTICS_SECRET", "");

    // With no secret there is no value that could match, so even an empty
    // bearer must not get through.
    const response = await GET(request("https://pryva.test/x", "Bearer "));
    expect(response.status).toBe(401);
  });

  /**
   * Diagnostics has its own credential because CRON_SECRET also opens the
   * auto-refund, scheduled-orders and wallet-email crons. Handing out the right
   * to read a status report must not hand out the right to fire a refund run, so
   * these pin the separation in both directions.
   */
  it("accepts a diagnostics-only secret with no cron secret configured at all", async () => {
    stubFetch({});
    vi.stubEnv("DIAGNOSTICS_SECRET", "diag-only-secret");
    vi.stubEnv("CRON_SECRET", "");

    const response = await GET(request("https://pryva.test/x", "Bearer diag-only-secret"));

    expect(response.status).toBe(200);
  });

  it("still accepts the cron secret, so an existing deployment is not locked out", async () => {
    stubFetch({});

    expect((await GET(request("https://pryva.test/x", `Bearer ${CRON_SECRET}`))).status).toBe(200);
  });

  it("refuses a near miss against either credential", async () => {
    stubFetch({});
    vi.stubEnv("DIAGNOSTICS_SECRET", "diag-only-secret");

    // A trailing space is not in this list on purpose: the Headers API strips
    // trailing whitespace, so that value cannot be constructed and asserting on
    // it would test the platform's normalisation rather than this route.
    for (const bearer of ["diag-only-secretx", `${CRON_SECRET}x`, "diag only secret", "Bearer diag-only-secret", ""]) {
      expect((await GET(request("https://pryva.test/x", `Bearer ${bearer}`))).status, bearer).toBe(401);
    }
  });

  it("reports the connected-but-empty feed, and only the tail of the key", async () => {
    // `/api/accounts` returns the balance as a bare value, not an object.
    stubFetch({ products: NO_BALANCE, balance: { data: "0.00", statusCode: 200 } });

    const response = await GET(request("https://pryva.test/x", `Bearer ${CRON_SECRET}`));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.accounts.configured).toBe(true);
    expect(body.accounts.catalog).toEqual({
      state: "no_products",
      detail: "insufficient account balance!",
    });
    expect(body.accounts.balanceMicros).toBe(0);
    expect(body.database.persistent).toBe(true);
    expect(body.marketplace.purchaseEnabled).toBe(true);
    expect(body.marketplace.checkoutConfigured).toBe(true);
    expect(body.manualFulfilmentReachable).toBe(false);

    // The whole point of the gate: the answer is visible, the credential is not.
    const text = JSON.stringify(body);
    expect(text).not.toContain(API_KEY);
    expect(body.accounts.keyTail).toBe("…9876");
  });

  it("still refuses marketplace purchasing on the in-memory preview database, key or no key", async () => {
    stubFetch({ products: NO_BALANCE });
    // Demo funds must never reach a real feed, even with a live key present.
    vi.stubEnv("PGHOST", "");
    vi.stubEnv("PGUSER", "");
    vi.stubEnv("AWS_REGION", "");
    vi.stubEnv("AWS_ROLE_ARN", "");

    const response = await GET(request("https://pryva.test/x", `Bearer ${CRON_SECRET}`));
    const body = await response.json();

    expect(body.accounts.configured).toBe(true);
    expect(body.database.persistent).toBe(false);
    expect(body.marketplace.purchaseEnabled).toBe(false);
    expect(body.marketplace.checkoutConfigured).toBe(false);
  });
});

describe("storefront reflects configuration at request time", () => {
  it("renders /accounts per request, so a feed connected after the build is not frozen out", async () => {
    // The pause banner on this page is decided by environment variables. Without
    // the dynamic export Next prerenders the page during the build and the value
    // is frozen — which is exactly how the storefront kept announcing that
    // checkout was paused after the account feed had been connected, while the
    // listings API served from the same deployment said the opposite.
    const page = await import("@/app/(site)/accounts/page");
    expect(page.dynamic).toBe("force-dynamic");
  });
});

/* ------------------------------------------------------------------ */
/* Feed probes                                                         */
/* ------------------------------------------------------------------ */

const FLEEXA_KEY = "fleexa-key-ABCD1234";
const BITCALL_ID = "ak_test_WXYZ5678";
// The client refuses a secret that is not 128 hex characters before it spends a
// request, so the fixture has to satisfy that or the probe never reaches fetch.
const BITCALL_SECRET = "0123456789abcdef".repeat(8);

/** Route by host and path, so one stub can stand in for every feed at once. */
function stubFeeds(routes: {
  emailProducts?: unknown;
  emailStatus?: number;
  sms?: unknown;
  rent?: unknown;
  fleexaBalance?: unknown;
  bitcall?: unknown;
} = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const path = url.pathname;

    if (url.hostname === "api.bitcall.io") {
      return jsonResponse(routes.bitcall ?? { data: { balance: 12.5, currency: "EUR" } });
    }
    if (url.hostname === "fleexa.com.ng") {
      if (path.endsWith("/email/products")) {
        return jsonResponse(
          routes.emailProducts ?? {
            data: [{ id: "inbox-24", name: "24 hour inbox", domain: "inbox.test", price_ngn: 250, stock: 40 }],
          },
          routes.emailStatus ?? 200,
        );
      }
      if (path.endsWith("/sms4/apps")) {
        return jsonResponse(routes.sms ?? {
          data: [{ id: "google", name: "Google", country: "NG", price_ngn: 350, stock: 12 }],
        });
      }
      if (path.endsWith("/rent/sms4/areas")) {
        return jsonResponse(routes.rent ?? { areas: [{ id: "ng", country: "NG", price_ngn: 9000, stock: 5 }] });
      }
      if (path.endsWith("/balance")) {
        return jsonResponse(routes.fleexaBalance ?? { data: { balance: 1500, currency: "NGN" } });
      }
    }
    // Anything else is the accounts feed.
    if (path.includes("products")) return jsonResponse(NO_BALANCE);
    return jsonResponse({ data: "0.00", statusCode: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function authed() {
  return request("https://pryva.test/x", `Bearer ${CRON_SECRET}`);
}

describe("feed probes: configured is not the same as working", () => {
  beforeEach(() => {
    vi.stubEnv("FLEEXA_API_KEY", FLEEXA_KEY);
    vi.stubEnv("BITCALL_KEY_ID", BITCALL_ID);
    vi.stubEnv("BITCALL_API_SECRET", BITCALL_SECRET);
  });

  it("reports what each feed actually offers, and only the tail of each key", async () => {
    stubFeeds();

    const response = await GET(authed());
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.numbers.configured).toBe(true);
    expect(body.numbers.emailProducts).toEqual({
      ok: true,
      value: {
        count: 1,
        sample: [{ id: "inbox-24", name: "24 hour inbox", domain: "inbox.test", priceNgn: 250, stock: 40 }],
      },
    });
    expect(body.numbers.smsServices.value.count).toBe(1);
    expect(body.numbers.rentAreas.value.count).toBe(1);
    expect(body.numbers.balance).toEqual({ ok: true, value: { balance: 1500, currency: "NGN" } });

    // A key that merely exists says nothing; a balance read proves it authenticates.
    expect(body.gateway.configured).toBe(true);
    expect(body.gateway.balance).toEqual({ ok: true, value: { balance: 12.5, currency: "EUR" } });

    const text = JSON.stringify(body);
    expect(text).not.toContain(FLEEXA_KEY);
    expect(text).not.toContain(BITCALL_ID);
    expect(text).not.toContain(BITCALL_SECRET);
    expect(body.numbers.keyTail).toBe("…1234");
    expect(body.gateway.keyTail).toBe("…5678");
  });

  it("keeps the other feeds visible when one of them fails", async () => {
    stubFeeds({ emailStatus: 500 });

    const response = await GET(authed());
    // A single unreachable catalog is a finding, not a reason to fail the report.
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.numbers.emailProducts.ok).toBe(false);
    expect(body.numbers.smsServices.ok).toBe(true);
    expect(body.numbers.rentAreas.ok).toBe(true);
    expect(body.gateway.balance.ok).toBe(true);
    expect(body.accounts.catalog).toEqual({ state: "no_products", detail: "insufficient account balance!" });
  });

  it("caps the sample rather than echoing an entire catalog", async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `inbox-${i}`, name: `Inbox ${i}`, domain: "inbox.test", price_ngn: 100 + i, stock: i }));
    stubFeeds({ emailProducts: { data: many } });

    const body = await (await GET(authed())).json();
    expect(body.numbers.emailProducts.value.count).toBe(40);
    expect(body.numbers.emailProducts.value.sample).toHaveLength(5);
  });

  it("says not configured rather than probing when a key is absent", async () => {
    const fetchMock = stubFeeds();
    vi.stubEnv("FLEEXA_API_KEY", "");
    vi.stubEnv("BITCALL_API_SECRET", "");

    const body = await (await GET(authed())).json();
    expect(body.numbers).toEqual({ configured: false });
    expect(body.gateway).toEqual({ configured: false });

    // Half a credential cannot authenticate, so it must not be reported as ready.
    const hosts = fetchMock.mock.calls.map(([input]) => new URL(String(input)).hostname);
    expect(hosts).not.toContain("fleexa.com.ng");
    expect(hosts).not.toContain("api.bitcall.io");
  });
});
