// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDigitalExplorer } from "@/components/dashboard/useDigitalExplorer";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("digital catalogue recovery", () => {
  it("keeps a throttle cooldown until it expires and retries only the failed shelf", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T12:00:00Z"));
    let available = false;
    const fetchMock = vi.fn(async (url: string) => {
      const root = new URL(url, "https://example.test").searchParams.get("category");
      if (root === "subscriptions" && !available) return Response.json({ error: "busy" }, { status: 429, headers: { "Retry-After": "6" } });
      return Response.json({ ok: true, items: root === "subscriptions" ? [{ id: `digital-${"a".repeat(24)}`, name: "Streaming subscription", stock: "reported" }] : [], nextCursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDigitalExplorer(true, "subscriptions", ""));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.reason).toBe("throttled");
    expect(result.current.retryBlocked).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { await result.current.retry(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_999); });
    expect(result.current.retryBlocked).toBe(true);
    available = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.retryBlocked).toBe(false);
    await act(async () => { await result.current.retry(); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.items.map((item) => item.name)).toContain("Streaming subscription");
    expect(result.current.error).toBe(false);
  });

  it("cancels a retry on a category change and does not replace the new results", async () => {
    vi.useFakeTimers();
    let subscriptionsReads = 0;
    let retrySignal: AbortSignal | undefined;
    const fetchMock = vi.fn((url: string, init: RequestInit) => {
      const root = new URL(url, "https://example.test").searchParams.get("category");
      if (root === "subscriptions") {
        if (++subscriptionsReads === 1) return Promise.resolve(Response.json({ error: "down" }, { status: 500 }));
        retrySignal = init.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => retrySignal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
      }
      return Promise.resolve(Response.json({ ok: true, items: root === "games" ? [{ id: `digital-${"b".repeat(24)}`, name: "New game", stock: "reported" }] : [], nextCursor: null }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(({ category }) => useDigitalExplorer(true, category, ""), {
      initialProps: { category: "subscriptions" as "subscriptions" | "games" },
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.reason).toBe("error");
    let retry: Promise<void> | undefined;
    act(() => { retry = result.current.retry(); });
    expect(retrySignal?.aborted).toBe(false);
    rerender({ category: "games" });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); await retry; });
    expect(retrySignal?.aborted).toBe(true);
    expect(result.current.items.map((item) => item.name)).toContain("New game");
    expect(result.current.error).toBe(false);
  });
});
