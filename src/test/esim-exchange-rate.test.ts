import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRateCache, getFreshNgnRate } from "@/lib/payments/exchange-rate";

const NOW = Date.parse("2026-11-05T12:00:00Z");

function response(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    result: "success",
    base_code: "EUR",
    time_last_update_unix: NOW / 1000 - 60,
    rates: { NGN: 1800 },
    ...overrides,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("USD_NGN_RATE", "");
  vi.stubEnv("EUR_NGN_RATE", "");
  clearRateCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearRateCache();
});

describe("purchase-sensitive eSIM rates", () => {
  it("uses an explicitly configured funding rate without a network request", async () => {
    vi.stubEnv("EUR_NGN_RATE", "1850");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await getFreshNgnRate("EUR")).toMatchObject({ rate: 1850, source: "override" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not silently ignore an invalid or implausibly low configured rate", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const bad of ["not-a-rate", "1", "0", "-5", "Infinity"]) {
      vi.stubEnv("EUR_NGN_RATE", bad);
      expect(await getFreshNgnRate("EUR")).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates a recent EUR quote, caches it and deduplicates concurrent reads", async () => {
    const fetchMock = vi.fn().mockImplementation(() => response());
    vi.stubGlobal("fetch", fetchMock);
    const [a, b] = await Promise.all([getFreshNgnRate("EUR"), getFreshNgnRate("EUR")]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ rate: 1800, source: "live" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://open.er-api.com/v6/latest/EUR");
    expect(await getFreshNgnRate("EUR")).toEqual(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { result: "error" },
    { base_code: "USD" },
    { rates: { NGN: 0 } },
    { rates: { NGN: "1800" } },
    { time_last_update_unix: NOW / 1000 - 37 * 60 * 60 },
    { time_last_update_unix: NOW / 1000 + 6 * 60 },
    { time_last_update_unix: null },
  ])("refuses invalid, mismatched, missing, future or stale rate data: %j", async (overrides) => {
    const fetchMock = vi.fn().mockImplementation(() => response(overrides));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getFreshNgnRate("EUR")).toBeNull();
    // A failure is briefly cached to avoid a failing lookup per plan.
    expect(await getFreshNgnRate("EUR")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not fall back to a made-up rate if the lookup fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("USD_NGN_FALLBACK", "1600");
    expect(await getFreshNgnRate("USD")).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe("https://open.er-api.com/v6/latest/USD");
  });
});
