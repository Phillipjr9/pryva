import { afterEach, describe, expect, it, vi } from "vitest";
import { cataloguePool, fetchCatalogue } from "@/lib/platform/catalog-fetch";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("catalogue reads", () => {
  it("retries transient responses without caching customer data", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(Response.json({ items: [] }));
    vi.stubGlobal("fetch", fetcher);
    const pending = fetchCatalogue("/api/services/catalog");
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: "no-store", redirect: "error" });
  });
  it.each([401, 403, 400])("does not retry HTTP %s", async status => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status }));
    vi.stubGlobal("fetch", fetcher);
    expect((await fetchCatalogue("/api/catalog")).status).toBe(status);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("honours a long rate-limit cooldown without more requests", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 429, headers: { "retry-after": "60" } }));
    vi.stubGlobal("fetch", fetcher);
    expect((await fetchCatalogue("/api/catalog")).status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("bounds retries", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response("", { status: 503 })));
    vi.stubGlobal("fetch", fetcher);
    const pending = fetchCatalogue("/api/catalog");
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("processes all shelves with at most three concurrent reads", async () => {
    const seen: number[] = []; let active = 0; let peak = 0;
    await cataloguePool(Array.from({ length: 35 }, (_, i) => i), async item => {
      active++; peak = Math.max(peak, active);
      await Promise.resolve(); seen.push(item); active--;
    }, new AbortController().signal);
    expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: 35 }, (_, i) => i));
    expect(peak).toBeLessThanOrEqual(3);
  });
  it("stops queued work on navigation or logout", async () => {
    const controller = new AbortController(); const seen: number[] = [];
    await cataloguePool([1, 2, 3, 4, 5], async item => { seen.push(item); controller.abort(); }, controller.signal, 1);
    expect(seen).toEqual([1]);
  });
});
