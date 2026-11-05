import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cacheHarness = vi.hoisted(() => ({
  keyParts: [] as unknown[],
  options: undefined as unknown,
  arguments: [] as unknown[][],
}));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => Promise<unknown>, keyParts: unknown[], options: unknown) => {
    cacheHarness.keyParts = keyParts;
    cacheHarness.options = options;
    return (...args: unknown[]) => {
      cacheHarness.arguments.push(args);
      return fn(...args);
    };
  },
}));

import { clearAuthenticatedRateCache, getAuthenticatedNgnRate } from "@/lib/payments/authenticated-exchange-rate";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const FIRST_KEY = "fake-cache-fixture-first";
const SECOND_KEY = "fake-cache-fixture-second";
function success() {
  return new Response(JSON.stringify({
    result: "success", base_code: "USD", time_last_update_unix: Math.floor(Date.now() / 1000) - 60,
    conversion_rates: { NGN: 1700 },
  }));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("EXCHANGE_RATE_API_KEY", FIRST_KEY);
  clearAuthenticatedRateCache();
  cacheHarness.arguments = [];
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  clearAuthenticatedRateCache();
});

describe("authenticated shared-cache boundary", () => {
  it("passes only a credential digest into the shared cache and changes it after rotation", async () => {
    const fetchMock = vi.fn().mockImplementation(() => success());
    vi.stubGlobal("fetch", fetchMock);
    expect(await getAuthenticatedNgnRate("USD")).toMatchObject({ rate: 1700 });
    vi.stubEnv("EXCHANGE_RATE_API_KEY", SECOND_KEY);
    expect(await getAuthenticatedNgnRate("USD")).toMatchObject({ rate: 1700 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cacheHarness.keyParts).toEqual(["authenticated-ngn-rate-v1"]);
    expect(cacheHarness.options).toEqual({ revalidate: 6 * 60 * 60 });
    expect(cacheHarness.arguments).toHaveLength(2);
    expect(cacheHarness.arguments[0][0]).toBe("USD");
    expect(cacheHarness.arguments[0][1]).toMatch(/^[a-f0-9]{64}$/);
    expect(cacheHarness.arguments[1][1]).not.toBe(cacheHarness.arguments[0][1]);
    const serialized = JSON.stringify([cacheHarness.keyParts, cacheHarness.arguments]);
    expect(serialized).not.toContain(FIRST_KEY);
    expect(serialized).not.toContain(SECOND_KEY);
  });

  it("coalesces concurrent failures and briefly suppresses retries, without caching a failed rate as success", async () => {
    const fetchMock = vi.fn().mockImplementation(() => new Response("denied", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await Promise.all(Array.from({ length: 8 }, () => getAuthenticatedNgnRate("USD")))).toEqual(Array(8).fill(null));
    expect(await getAuthenticatedNgnRate("USD")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_001);
    expect(await getAuthenticatedNgnRate("USD")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
