import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ limit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ createRateLimiter: () => runtime.limit }));

import { buyFleexaProxy, checkFleexaProxy, fleexaProxyPlanMap, listFleexaProxyProducts } from "@/lib/fleexa";
import { isProxyOrderingAvailable, isProxyPlanSellable, PROXY_PLAN_QUOTAS, proxyQuotaFor } from "@/lib/proxy-plans";
import { plans } from "@/lib/catalog";

/**
 * Proxies, up to the line that money crosses.
 *
 * Fleexa carries proxy products, so the supplier client now knows how to read
 * them and how to buy an allowance. What is deliberately absent is the checkout:
 * the endpoint shapes follow the supplier's own house style but are not verified,
 * and debiting a wallet against an unverified endpoint is how a purchase becomes
 * a refund someone has to make by hand.
 *
 * Three separate switches stand between "configured" and "sellable", and these
 * tests exist so none of them can be skipped by accident later.
 */

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.stubEnv("FLEEXA_API_KEY", "provider-secret");
  vi.stubEnv("FLEEXA_BASE_URL", "");
  vi.stubEnv("FLEEXA_API_URL", "");
  runtime.limit.mockResolvedValue({ allowed: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("quota mapping", () => {
  it("agrees with the published catalogue, so a plan cannot promise one thing and buy another", () => {
    const proxyPlans = plans.filter((plan) => plan.service === "proxies");
    expect(proxyPlans.length).toBeGreaterThan(0);
    for (const plan of proxyPlans) {
      const quota = proxyQuotaFor(plan.slug);
      expect(quota, `${plan.slug} has no quota`).not.toBeNull();
      // "5GB · 30 days" must match the gigabytes and days we would send upstream.
      expect(plan.planLabel.toLowerCase()).toContain(`${quota!.gigabytes}gb`);
      expect(plan.duration).toContain(`${quota!.days} days`);
    }
    // And no quota exists for a plan that is not in the catalogue.
    for (const slug of Object.keys(PROXY_PLAN_QUOTAS)) {
      expect(proxyPlans.some((plan) => plan.slug === slug), `${slug} is not a plan`).toBe(true);
    }
  });

  it("refuses an unknown slug rather than defaulting to a size", () => {
    expect(proxyQuotaFor("proxy-mars-99")).toBeNull();
    expect(proxyQuotaFor(undefined)).toBeNull();
  });
});

describe("the three switches", () => {
  const MAP = JSON.stringify({ "proxy-ng-1": "px_ng_1gb" });

  it("stays off with a key but no enable flag", () => {
    vi.stubEnv("FLEEXA_API_KEY", "provider-secret");
    vi.stubEnv("FLEEXA_PROXY_PRODUCTS", MAP);
    expect(isProxyOrderingAvailable()).toBe(false);
    expect(isProxyPlanSellable("proxy-ng-1")).toBe(false);
  });

  it("stays off when enabled but nothing is mapped", () => {
    vi.stubEnv("FLEEXA_PROXY_ENABLED", "1");
    vi.stubEnv("FLEEXA_PROXY_PRODUCTS", "");
    expect(isProxyOrderingAvailable()).toBe(false);
  });

  it("stays off with no supplier key, whatever else is set", () => {
    vi.stubEnv("FLEEXA_API_KEY", "");
    vi.stubEnv("FLEEXA_PROXY_ENABLED", "1");
    vi.stubEnv("FLEEXA_PROXY_PRODUCTS", MAP);
    expect(isProxyOrderingAvailable()).toBe(false);
  });

  it("sells only the plans that are mapped, once all three are set", () => {
    vi.stubEnv("FLEEXA_PROXY_ENABLED", "1");
    vi.stubEnv("FLEEXA_PROXY_PRODUCTS", MAP);
    expect(isProxyOrderingAvailable()).toBe(true);
    expect(isProxyPlanSellable("proxy-ng-1")).toBe(true);
    // A catalogue plan with no product mapping cannot be bought, even though it
    // has a quota: the supplier never told us which product it is.
    expect(isProxyPlanSellable("proxy-ng-5")).toBe(false);
  });

  it("ignores a malformed map instead of guessing", () => {
    vi.stubEnv("FLEEXA_PROXY_PRODUCTS", "{not json");
    expect(fleexaProxyPlanMap()).toEqual({});
    vi.stubEnv("FLEEXA_PROXY_PRODUCTS", '["px_1"]');
    expect(fleexaProxyPlanMap()).toEqual({});
    vi.stubEnv("FLEEXA_PROXY_PRODUCTS", '{"proxy-ng-1": 5}');
    expect(fleexaProxyPlanMap()).toEqual({});
  });
});

describe("supplier client", () => {
  it("reads products across the alias fields, including size, validity and naira price", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({
      success: true,
      data: [
        { product_id: "px_ng_1gb", name: "Nigeria 1GB", gigabytes: 1, days: 7, region: "NG", price_ngn: 2690 },
        { id: "px_us_5gb", title: "US 5GB", bandwidth_gb: "5", validity_days: "30", country_code: "US", amount: 13460 },
        { name: "No identifier" },
      ],
    })));
    const products = await listFleexaProxyProducts();
    expect(products).toHaveLength(2);
    expect(products[0]).toMatchObject({ productId: "px_ng_1gb", gigabytes: 1, days: 7, region: "NG", priceNgn: 2690 });
    expect(products[1]).toMatchObject({ productId: "px_us_5gb", gigabytes: 5, days: 30, region: "US", priceNgn: 13460 });
  });

  it("buys with our own reference so a retry cannot open a second allowance", async () => {
    const fetchMock = vi.fn().mockImplementation(() => json({
      success: true,
      data: {
        access_id: "acc_1", host: "gate.example", port: "8000", username: "u1", password: "p1",
        protocol: "socks5", expires_at: "2026-12-01T00:00:00Z", limit_gb: 5, used_gb: 0,
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const access = await buyFleexaProxy({ productId: "px_ng_5gb", reference: "PRY-ABC123", gigabytes: 5, days: 30 });
    expect(access).toMatchObject({
      accessId: "acc_1", host: "gate.example", port: 8000, username: "u1", password: "p1",
      protocol: "socks5", limitGb: 5, usedGb: 0,
    });
    expect(access.expiresAt?.toISOString()).toBe("2026-12-01T00:00:00.000Z");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url.endsWith("/proxy/buy")).toBe(true);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({ product_id: "px_ng_5gb", reference: "PRY-ABC123", gigabytes: 5, days: 30 });
    // The key travels in headers only, never in the URL.
    expect(url).not.toContain("provider-secret");
    expect(init.headers.Authorization).toBe("Bearer provider-secret");
  });

  it("refuses a purchase response with no allowance id instead of inventing one", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ success: true, data: { host: "gate.example" } })));
    await expect(buyFleexaProxy({ productId: "px", reference: "PRY-1", gigabytes: 1, days: 7 }))
      .rejects.toMatchObject({ code: "INVALID_PROXY_ACCESS" });
  });

  it("reads usage back, which is the only way an overage is noticed the same day", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({
      success: true, data: { access_id: "acc_1", limit_gb: 5, used_gb: 1.25, host: "gate.example" },
    })));
    expect(await checkFleexaProxy("acc_1")).toMatchObject({ accessId: "acc_1", limitGb: 5, usedGb: 1.25 });
  });
});
