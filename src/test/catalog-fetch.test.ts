import { afterEach, describe, expect, it, vi } from "vitest";
import { cataloguePool, fetchCatalogue } from "@/lib/platform/catalog-fetch";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
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
  it("does not immediately retry a throttle when no cooldown was supplied", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
    vi.stubGlobal("fetch", fetcher);
    expect((await fetchCatalogue("/api/catalog")).status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("honours an HTTP-date cooldown rather than retrying before it expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T12:00:00Z"));
    const fetcher = vi.fn().mockResolvedValue(new Response("", {
      status: 429, headers: { "retry-after": "Thu, 12 Nov 2026 12:01:00 GMT" },
    }));
    vi.stubGlobal("fetch", fetcher);
    expect((await fetchCatalogue("/api/catalog")).status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["-1", "1.2.3", "not-a-date"])("does not treat an invalid throttle cooldown %s as a date", async (value) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 429, headers: { "retry-after": value } }));
    vi.stubGlobal("fetch", fetcher);
    expect((await fetchCatalogue("/api/catalog")).status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not bypass a short throttle when cancelling its response body fails", async () => {
    vi.useFakeTimers();
    const body = new ReadableStream({ cancel() { throw new Error("cancel failed"); } });
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(body, { status: 429, headers: { "retry-after": "3" } }))
      .mockResolvedValueOnce(Response.json({ items: [] }));
    vi.stubGlobal("fetch", fetcher);
    const pending = fetchCatalogue("/api/catalog");
    void pending.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("cancels a pending retry when the caller leaves", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    const pending = fetchCatalogue("/api/catalog", controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("allows a slow shared-snapshot response to finish and keeps the deadline bounded", async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), milliseconds);
      return controller.signal;
    });
    const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(Response.json({ items: ["complete"] })), 31_000);
      init.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); }, { once: true });
    }));
    vi.stubGlobal("fetch", fetcher);
    const pending = fetchCatalogue("/api/accounts/listings", undefined, { timeoutMs: 65_000 });
    // Observe a possible early rejection before advancing fake timers; the
    // original promise is still awaited below so a regression fails the test.
    void pending.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await (await pending).json()).toEqual({ items: ["complete"] });
    expect(timeout).toHaveBeenCalledWith(65_000);
    timeout.mockRestore();
  });
  it("caps an excessive requested deadline", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ items: [] })));
    await fetchCatalogue("/api/accounts/listings", undefined, { timeoutMs: 600_000 });
    expect(timeout).toHaveBeenCalledWith(65_000);
  });
  it("bounds retries for each feed in a fan-out", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    const pending = fetchCatalogue("/api/services/digital-catalog", undefined, { maxAttempts: 2 });
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(2);
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
