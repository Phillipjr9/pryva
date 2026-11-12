// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLiveServiceExplorer } from "@/components/dashboard/useLiveServiceExplorer";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const live = (items: object[] = []) => Response.json({ ok: true, country: "us", live: true, partial: false, items });
const social = { id: "social-1", category: "social", name: "Available boost" };

describe("live service recovery", () => {
  it("keeps healthy feeds visible and retries only the failed feed", async () => {
    vi.useFakeTimers();
    let numbersReads = 0;
    let finishRetry: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn((url: string) => {
      const feed = new URL(url, "https://example.test").searchParams.get("feed");
      if (feed === "numbers") {
        if (++numbersReads === 1) return Promise.resolve(Response.json({ error: "down" }, { status: 500 }));
        return new Promise<Response>((resolve) => { finishRetry = resolve; });
      }
      return Promise.resolve(live(feed === "social" ? [social] : []));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(({ revision }) => useLiveServiceExplorer("us", revision, false), { initialProps: { revision: 0 } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current?.reason).toBe("error");
    expect(result.current?.items.map((item) => item.name)).toContain("Available boost");
    rerender({ revision: 1 });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current?.items.map((item) => item.name)).toContain("Available boost");
    expect(finishRetry).toBeDefined();
    await act(async () => { finishRetry!(live([{ id: "numbers-1", category: "numbers", name: "Available plan" }])); });
    expect(result.current?.items.map((item) => item.name)).toEqual(expect.arrayContaining(["Available boost", "Available plan"]));
    const calls = fetchMock.mock.calls.map(([url]) => new URL(String(url), "https://example.test").searchParams);
    expect(calls.filter((params) => params.get("feed") === "numbers")).toHaveLength(2);
    expect(calls.filter((params) => params.get("feed") === "social")).toHaveLength(1);
    expect(calls.filter((params) => params.get("feed") === "esim")).toHaveLength(1);
    expect(calls.filter((params) => params.get("feed") === "verification")).toHaveLength(1);
  });

  it("retains an earlier partial feed if its refresh fails", async () => {
    vi.useFakeTimers();
    let socialReads = 0;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      const feed = new URL(url, "https://example.test").searchParams.get("feed");
      if (feed !== "social") return Promise.resolve(live());
      return Promise.resolve(++socialReads === 1
        ? Response.json({ ok: true, country: "us", live: true, partial: true, items: [social] })
        : Response.json({ error: "down" }, { status: 500 }));
    }));
    const { result, rerender } = renderHook(({ revision }) => useLiveServiceExplorer("us", revision, false), { initialProps: { revision: 0 } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current?.items.map((item) => item.name)).toContain("Available boost");
    rerender({ revision: 1 });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current?.items.map((item) => item.name)).toContain("Available boost");
    expect(result.current?.reason).toBe("error");
  });

  it("does not retry a throttled feed before its cooldown", async () => {
    vi.useFakeTimers();
    let available = false;
    const fetchMock = vi.fn((url: string) => {
      const feed = new URL(url, "https://example.test").searchParams.get("feed");
      return Promise.resolve(feed === "numbers" && !available
        ? Response.json({ error: "busy" }, { status: 429, headers: { "Retry-After": "6" } }) : live());
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(({ revision }) => useLiveServiceExplorer("us", revision, false), { initialProps: { revision: 0 } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current?.reason).toBe("throttled");
    expect(result.current?.retryBlocked).toBe(true);
    rerender({ revision: 1 });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    available = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(result.current?.retryBlocked).toBe(false);
    rerender({ revision: 2 });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(result.current?.reason).toBeNull();
  });
});
