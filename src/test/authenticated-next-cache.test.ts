import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let clearAuthenticatedRateCache: typeof import("@/lib/payments/authenticated-exchange-rate").clearAuthenticatedRateCache;
let getAuthenticatedNgnRate: typeof import("@/lib/payments/authenticated-exchange-rate").getAuthenticatedNgnRate;
let workAsyncStorage: typeof import("next/dist/server/app-render/work-async-storage.external").workAsyncStorage;
let workUnitAsyncStorage: typeof import("next/dist/server/app-render/work-unit-async-storage.external").workUnitAsyncStorage;

const NOW = Date.parse("2026-11-05T12:00:00Z");
const FIRST_KEY = "fake-real-cache-first";
const SECOND_KEY = "fake-real-cache-second";
const nextGlobal = globalThis as unknown as { __incrementalCache?: unknown; AsyncLocalStorage?: unknown };
let previousAsyncLocalStorage: unknown;
let previousCache: unknown;
let entries: Map<string, unknown>;
let invocationKeys: string[];
let forceStale: boolean;

beforeAll(async () => {
  // Next normally supplies this global when running inside its own server.
  previousAsyncLocalStorage = nextGlobal.AsyncLocalStorage;
  nextGlobal.AsyncLocalStorage = AsyncLocalStorage;
  ({ clearAuthenticatedRateCache, getAuthenticatedNgnRate } = await import("@/lib/payments/authenticated-exchange-rate"));
  ({ workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external"));
  ({ workUnitAsyncStorage } = await import("next/dist/server/app-render/work-unit-async-storage.external"));
});
afterAll(() => { nextGlobal.AsyncLocalStorage = previousAsyncLocalStorage; });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("EXCHANGE_RATE_API_KEY", FIRST_KEY);
  clearAuthenticatedRateCache();
  previousCache = nextGlobal.__incrementalCache;
  entries = new Map();
  invocationKeys = [];
  forceStale = false;
  // Exercise Next's actual unstable_cache wrapper with an in-memory stand-in
  // for its incremental-cache backend; no network or production cache is used.
  nextGlobal.__incrementalCache = {
    isOnDemandRevalidate: false,
    generateSimpleCacheKey: async (key: string) => {
      invocationKeys.push(key);
      return createHash("sha256").update(key).digest("hex");
    },
    get: async (key: string) => entries.has(key) ? { value: entries.get(key), isStale: forceStale } : null,
    set: async (key: string, value: unknown) => { entries.set(key, value); },
  };
});
afterEach(() => {
  nextGlobal.__incrementalCache = previousCache;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  clearAuthenticatedRateCache();
});

function success(rate = 1700) {
  return new Response(JSON.stringify({
    result: "success", base_code: "USD", time_last_update_unix: Math.floor(Date.now() / 1000) - 60,
    conversion_rates: { NGN: rate },
  }));
}

describe("Next incremental-cache integration", () => {
  it("reuses only a validated quote across process-local cache clears and separates rotations", async () => {
    const fetchMock = vi.fn().mockImplementation(() => success());
    vi.stubGlobal("fetch", fetchMock);
    expect(await getAuthenticatedNgnRate("USD")).toMatchObject({ rate: 1700 });
    clearAuthenticatedRateCache();
    expect(await getAuthenticatedNgnRate("USD")).toMatchObject({ rate: 1700 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.stubEnv("EXCHANGE_RATE_API_KEY", SECOND_KEY);
    clearAuthenticatedRateCache();
    expect(await getAuthenticatedNgnRate("USD")).toMatchObject({ rate: 1700 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(entries.size).toBe(2);
    expect(invocationKeys[0]).toBe(invocationKeys[1]);
    expect(invocationKeys[2]).not.toBe(invocationKeys[0]);
    const serialized = JSON.stringify([invocationKeys, Array.from(entries.values())]);
    expect(serialized).not.toContain(FIRST_KEY);
    expect(serialized).not.toContain(SECOND_KEY);
    expect(JSON.stringify(Array.from(entries.values()))).not.toContain("Authorization");
  });

  it("rechecks a shared hit locally after an hour, allowing background updates to be seen", async () => {
    const fetchMock = vi.fn().mockImplementation(() => success());
    vi.stubGlobal("fetch", fetchMock);
    expect(await getAuthenticatedNgnRate("USD")).toMatchObject({ rate: 1700 });
    const entry = entries.values().next().value as { data: { body: string } };
    entry.data.body = JSON.stringify({ currency: "USD", rate: 1750, publishedAt: new Date(NOW - 60_000).toISOString() });
    vi.advanceTimersByTime(61 * 60 * 1000);
    expect(await getAuthenticatedNgnRate("USD")).toMatchObject({ rate: 1750 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("revalidates a stale shared entry outside a request context", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(success(1700)).mockReturnValueOnce(success(1750));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getAuthenticatedNgnRate("USD")).toMatchObject({ rate: 1700 });
    clearAuthenticatedRateCache();
    forceStale = true;
    expect(await getAuthenticatedNgnRate("USD")).toMatchObject({ rate: 1750 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("revalidates stale entries in a request while returning only an age-validated quote", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(success(1700)).mockReturnValueOnce(success(1750));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getAuthenticatedNgnRate("USD")).toMatchObject({ rate: 1700 });
    clearAuthenticatedRateCache();
    forceStale = true;
    const work = { route: "/accounts", incrementalCache: nextGlobal.__incrementalCache, pendingRevalidates: {} as Record<string, Promise<unknown>> };
    const request = { type: "request", url: new URL("https://pryva.test/accounts") };
    const stale = await workAsyncStorage.run(work as never, () =>
      workUnitAsyncStorage.run(request as never, () => getAuthenticatedNgnRate("USD")),
    );
    expect(stale).toMatchObject({ rate: 1700 });
    await Promise.all(Object.values(work.pendingRevalidates));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    forceStale = false;
    vi.advanceTimersByTime(61 * 60 * 1000);
    expect(await getAuthenticatedNgnRate("USD")).toMatchObject({ rate: 1750 });
  });

  it("does not leak a credential through Next's background-revalidation error log", async () => {
    const fetchMock = vi.fn().mockReturnValueOnce(success()).mockRejectedValueOnce(new Error(`Bearer ${FIRST_KEY}`));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);
    expect(await getAuthenticatedNgnRate("USD")).not.toBeNull();
    clearAuthenticatedRateCache();
    forceStale = true;
    const work = { route: "/accounts", incrementalCache: nextGlobal.__incrementalCache, pendingRevalidates: {} as Record<string, Promise<unknown>> };
    const request = { type: "request", url: new URL("https://pryva.test/accounts") };
    await workAsyncStorage.run(work as never, () =>
      workUnitAsyncStorage.run(request as never, () => getAuthenticatedNgnRate("USD")),
    );
    await Promise.all(Object.values(work.pendingRevalidates));
    expect(consoleError).toHaveBeenCalled();
    const output = consoleError.mock.calls.flat().map(String).join(" ");
    expect(output).toContain("Authenticated exchange rate unavailable");
    expect(output).not.toContain(FIRST_KEY);
  });

  it("rejects a shared cached quote that exceeds the publication-age limit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => success()));
    expect(await getAuthenticatedNgnRate("USD")).not.toBeNull();
    clearAuthenticatedRateCache();
    vi.advanceTimersByTime(37 * 60 * 60 * 1000);
    // Even if a cache backend incorrectly calls this old entry fresh, it is not
    // returned as a purchase-sensitive quote.
    expect(await getAuthenticatedNgnRate("USD")).toBeNull();
  });
});
