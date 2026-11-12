import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({ limit: vi.fn() }));
vi.mock("@/lib/platform/rate-limit", () => ({ createRateLimiter: () => runtime.limit }));
import { buyFleexaProxy, extractFleexaProxy, getFleexaProxyCatalogue, getFleexaProxySlot, revealFleexaProxy } from "@/lib/providers/fleexa";

beforeEach(() => {
  vi.stubEnv("FLEEXA_API_KEY", "proxy-test-secret");
  vi.stubEnv("FLEEXA_BASE_URL", "");
  vi.stubEnv("FLEEXA_API_URL", "");
  runtime.limit.mockResolvedValue({ allowed: true, unavailable: false });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const status = { success: true, data: { service: "proxy", enabled: true, currency: "NGN", api_discount_percent: 50, expiry_hours: 6, plan_count: 1, country_count: 1 } };
const plans = { success: true, data: {
  currency: "NGN", expiry_hours: 6,
  plans: [{ id: "1789073144601", object: "proxy_plan", label: "1ips", quantity: 1, price_ngn: 580, per_ip_ngn: 580, currency: "NGN" }],
  categories: [{ id: "residential_http", name: "Residential HTTP/HTTPS", type: 2, description: "HTTP/HTTPS proxies with user:pass auth" }],
  countries: [{ code: "US", name: "United States", states: ["Random", "New York"] }],
} };
const credentials = { host: "107.151.197.202", port: 443, username: "user123", password: "pass123", url: "107.151.197.202:443:user123:pass123" };

describe("Fleexa residential proxy API", () => {
  it("parses enabled status, live NGN plans and country/state choices", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json(status))
      .mockResolvedValueOnce(Response.json(plans));
    vi.stubGlobal("fetch", fetch);
    await expect(getFleexaProxyCatalogue()).resolves.toMatchObject({
      status: { enabled: true, expiryHours: 6, planCount: 1, countryCount: 1 },
      plans: [{ id: "1789073144601", priceNgn: 580, quantity: 1 }],
      countries: [{ code: "US", states: ["Random", "New York"] }],
    });
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "https://fleexa.com.ng/developer/proxy/status",
      "https://fleexa.com.ng/developer/proxy/plans",
    ]);
  });

  it("fails closed when the proxy switch is off or catalogue shape is incomplete", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ ...status, data: { ...status.data, enabled: false } }))
      .mockResolvedValueOnce(Response.json(plans)));
    await expect(getFleexaProxyCatalogue()).rejects.toMatchObject({ code: "PROXY_UNAVAILABLE" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(status)).mockResolvedValueOnce(Response.json({ success: true, data: { plans: [] } })));
    await expect(getFleexaProxyCatalogue()).rejects.toMatchObject({ code: "PROXY_UNAVAILABLE" });
  });

  it("sends a price-pinned plan order with the idempotency header and keeps secrets out of the URL", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ success: true, data: {
      transaction_id: "transaction-1", reference: "proxy_api_1", amount_paid: 580, currency: "NGN",
      country: "US", proxy_type: 3,
      plan: { id: "1789073144601", quantity: 1 },
      slots: [{ id: "slot-1", object: "proxy", status: "purchased", extract_required: true, amount_paid: 580, currency: "NGN" }],
    } }));
    vi.stubGlobal("fetch", fetch);
    const result = await buyFleexaProxy({ planId: "1789073144601", country: "US", state: "Random", proxyType: 3, idempotencyKey: "order-uuid" });
    expect(result).toMatchObject({ transactionId: "transaction-1", amountPaid: 580, slots: [{ id: "slot-1", country: "US", status: "purchased", proxyType: 3 }] });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://fleexa.com.ng/developer/proxy/order");
    expect(init.method).toBe("POST");
    expect(init.headers["Idempotency-Key"]).toBe("order-uuid");
    expect(init.headers.Authorization).toBe("Bearer proxy-test-secret");
    expect(init.body).toBe(JSON.stringify({ plan_id: "1789073144601", country: "US", state: "Random", proxy_type: 3 }));
    expect(url).not.toContain("proxy-test-secret");
  });

  it("uses the explicit reveal endpoint only for active slots", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ success: true, data: {
      id: "slot-1", status: "active", country: "US", proxy_type: 2,
      expires_at: "2026-11-03T04:00:00.000Z", credentials,
    } }));
    vi.stubGlobal("fetch", fetch);
    await expect(revealFleexaProxy("slot-1", { country: "US", proxyType: 2 })).resolves.toMatchObject({ status: "active", credentials });
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://fleexa.com.ng/developer/proxy/orders/slot-1/reveal");
    expect((fetch.mock.calls[0]?.[1] as RequestInit).method).toBe("POST");
  });

  it("parses extraction credentials and owner-scoped slot details", async () => {
    const payload = { success: true, data: { id: "slot-1", object: "proxy", status: "active", extract_required: false, expires_at: "2026-11-03T04:00:00.000Z", credentials } };
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json(payload))
      .mockResolvedValueOnce(Response.json(payload));
    vi.stubGlobal("fetch", fetch);
    await expect(extractFleexaProxy("slot-1", { country: "US", proxyType: 2 })).resolves.toMatchObject({ status: "active", country: "US", credentials });
    await expect(getFleexaProxySlot("slot-1", { country: "US", proxyType: 2 })).resolves.toMatchObject({ status: "active", country: "US", credentials });
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "https://fleexa.com.ng/developer/proxy/orders/slot-1/extract",
      "https://fleexa.com.ng/developer/proxy/orders/slot-1",
    ]);
  });
});
