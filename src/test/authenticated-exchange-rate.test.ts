import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRateCache, getFreshNgnRate, getUsdToNgnRate } from "@/lib/payments/exchange-rate";
import { logger } from "@/lib/platform/logger";
import { priceMarketplaceListing } from "@/lib/services/accounts/marketplace-pricing";
import { supplierAmountToNgn } from "@/lib/payments/supplier-currency";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const FIXTURE_KEY = "fake-test-token-only";

function quote(currency: string, overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    result: "success", base_code: currency,
    time_last_update_unix: Math.floor(Date.now() / 1000) - 60,
    conversion_rates: { NGN: currency === "USD" ? 1700 : 1800 },
    ...overrides,
  }), { headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("EXCHANGE_RATE_API_KEY", FIXTURE_KEY);
  vi.stubEnv("USD_NGN_RATE", "");
  vi.stubEnv("EUR_NGN_RATE", "");
  clearRateCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  clearRateCache();
});

describe("authenticated exchange rates used across the application", () => {
  it("uses bearer authentication for both currencies and shares a USD lookup between pricing paths", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => quote(url.endsWith("/EUR") ? "EUR" : "USD"));
    vi.stubGlobal("fetch", fetchMock);
    const [usd, eur, marketplace] = await Promise.all([
      getFreshNgnRate("USD"), getFreshNgnRate("EUR"), getUsdToNgnRate(),
    ]);
    expect(usd).toMatchObject({ rate: 1700, source: "authenticated" });
    expect(eur).toMatchObject({ rate: 1800, source: "authenticated" });
    expect(marketplace).toMatchObject({ rate: 1700, source: "authenticated" });
    expect(await priceMarketplaceListing({ unitPriceUsd: "1.00", quantity: 1 })).toMatchObject({ fxRate: 1700, fxSource: "authenticated" });
    expect(await supplierAmountToNgn(2, "USD")).toBe(3400);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toMatch(/^https:\/\/v6\.exchangerate-api\.com\/v6\/latest\/(USD|EUR)$/);
      expect(url).not.toContain(FIXTURE_KEY);
      expect(init.headers.Authorization).toBe(`Bearer ${FIXTURE_KEY}`);
      expect(init.cache).toBe("no-store");
      expect(init.redirect).toBe("error");
    }
    expect(JSON.stringify([usd, eur, marketplace])).not.toContain(FIXTURE_KEY);
  });

  it("makes no public request when no key is configured", async () => {
    vi.stubEnv("EXCHANGE_RATE_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await getFreshNgnRate("EUR")).toBeNull();
    expect(await getFreshNgnRate("USD")).toBeNull();
    expect(await getUsdToNgnRate()).toMatchObject({ source: "fallback" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves explicit funding-rate overrides without contacting any provider", async () => {
    vi.stubEnv("USD_NGN_RATE", "1850");
    vi.stubEnv("EUR_NGN_RATE", "1950");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await getUsdToNgnRate()).toMatchObject({ rate: 1850, source: "override" });
    expect(await getFreshNgnRate("USD")).toMatchObject({ rate: 1850, source: "override" });
    expect(await getFreshNgnRate("EUR")).toMatchObject({ rate: 1950, source: "override" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not use a public backup when authentication fails or log the credential", async () => {
    const warning = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn().mockRejectedValue(new Error(`unexpected: Bearer ${FIXTURE_KEY}`));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getFreshNgnRate("EUR")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://v6.exchangerate-api.com/v6/latest/EUR");
    expect(JSON.stringify(warning.mock.calls)).not.toContain(FIXTURE_KEY);
  });

  it.each([
    { result: "error", "error-type": "invalid-key" },
    { base_code: "USD" },
    { conversion_rates: { NGN: "1800" } },
    { conversion_rates: { NGN: 0 } },
    { time_last_update_unix: NOW / 1000 - 37 * 60 * 60 },
    { time_last_update_unix: NOW / 1000 + 6 * 60 },
    { time_last_update_unix: null },
  ])("rejects invalid or stale authenticated responses: %j", async (overrides) => {
    const fetchMock = vi.fn().mockImplementation(() => quote("EUR", overrides));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getFreshNgnRate("EUR")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized authenticated response without trying a public feed", async () => {
    const fetchMock = vi.fn().mockImplementation(() => quote("EUR", { padding: "x".repeat(256_000) }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getFreshNgnRate("EUR")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the legacy fixed fallback for non-eSIM pricing if the keyed endpoint is down", async () => {
    const fetchMock = vi.fn().mockImplementation(() => new Response("down", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getUsdToNgnRate()).toMatchObject({ source: "fallback" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://v6.exchangerate-api.com/v6/latest/USD");
  });

  it("never sends a malformed token in a request header", async () => {
    vi.stubEnv("EXCHANGE_RATE_API_KEY", "bad\r\nheader");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await getFreshNgnRate("EUR")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never uses the fixed USD fallback for an eSIM quote if the keyed endpoint fails", async () => {
    const fetchMock = vi.fn().mockImplementation(() => new Response("down", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getFreshNgnRate("USD")).toBeNull();
    expect(await getUsdToNgnRate()).toMatchObject({ source: "fallback" });
    // The failed authenticated lookup is briefly coalesced, not replaced with a public request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resumes eSIM pricing after a temporary failure without using a public backup", async () => {
    const fetchMock = vi.fn().mockImplementationOnce(() => new Response("down", { status: 503 })).mockImplementation(() => quote("EUR"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getFreshNgnRate("EUR")).toBeNull();
    vi.advanceTimersByTime(60_001);
    expect(await getFreshNgnRate("EUR")).toMatchObject({ rate: 1800, source: "authenticated" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([url]) => url === "https://v6.exchangerate-api.com/v6/latest/EUR")).toBe(true);
  });

  it("caches authenticated quotes locally for six hours and refreshes after the interval", async () => {
    const fetchMock = vi.fn().mockImplementation(() => quote("USD"));
    vi.stubGlobal("fetch", fetchMock);
    await getFreshNgnRate("USD");
    vi.advanceTimersByTime(5 * 60 * 60 * 1000);
    await getFreshNgnRate("USD");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(61 * 60 * 1000);
    await getFreshNgnRate("USD");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
