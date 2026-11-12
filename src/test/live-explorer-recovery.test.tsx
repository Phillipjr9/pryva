// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLiveServiceExplorer } from "@/components/dashboard/useLiveServiceExplorer";
import type { ExplorerFilter } from "@/lib/services/service-explorer";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const live = (items: object[] = []) => Response.json({ ok: true, country: "us", live: true, partial: false, items });
const social = { id: "social-1", category: "social", name: "Available boost", description: "Boost", tag: "Followers",
  artwork: { kind: "service", name: "social-promotion" }, source: "live", coverage: "not-country-specific", stock: null, myUnits: null, price: null, action: null };
const number = { id: "numbers-1", category: "numbers", name: "Available plan", description: "Rental", tag: "Rental",
  artwork: { kind: "service", name: "numbers" }, source: "live", coverage: "catalog-country", stock: null, myUnits: null, price: null, action: null };

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
    await act(async () => { finishRetry!(live([number])); });
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

  it("loads only the selected shelves and reuses in-flight reads while switching categories", async () => {
    vi.useFakeTimers();
    let finishVerification: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn((url: string) => {
      const feed = new URL(url, "https://example.test").searchParams.get("feed");
      if (feed === "verification") return new Promise<Response>((resolve) => { finishVerification = resolve; });
      return Promise.resolve(live(feed === "social" ? [social] : feed === "numbers" ? [number] : []));
    });
    vi.stubGlobal("fetch", fetchMock);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const { result, rerender } = renderHook(({ category }) => useLiveServiceExplorer("us", 0, false, category),
      { initialProps: { category: "social" as ExplorerFilter } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current?.items.map((item) => item.name)).toContain("Available boost");
    expect(timeout).toHaveBeenCalledWith(65_000);

    rerender({ category: "numbers" });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current?.verificationLoading).toBe(true);
    rerender({ category: "verification" });
    rerender({ category: "numbers" });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => { finishVerification!(live()); });
    expect(result.current?.verificationLoading).toBe(false);
    rerender({ category: "all" });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const feeds = fetchMock.mock.calls.map(([url]) => new URL(url, "https://example.test").searchParams.get("feed"));
    expect(feeds).toEqual(["social", "numbers", "verification", "esim"]);
    expect(result.current?.items.map((item) => item.name)).toEqual(expect.arrayContaining(["Available boost", "Available plan"]));
  });

  it("does not briefly reuse an old feed as current after the explorer is disabled and reopened", async () => {
    vi.useFakeTimers();
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(live([social]))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(({ enabled }) => useLiveServiceExplorer("us", 0, false, "social", enabled),
      { initialProps: { enabled: true } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current?.items.map((item) => item.name)).toContain("Available boost");
    rerender({ enabled: false });
    expect(result.current).toBeNull();
    // Reopen before a deferred state clear could run.
    rerender({ enabled: true });
    expect(result.current).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current).toMatchObject({ loading: true, items: [] });
    await act(async () => finish(live()));
    expect(result.current).toMatchObject({ loading: false, items: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not reuse previous-country results when switching away and back before the new request starts", async () => {
    vi.useFakeTimers();
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(live([social]))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(({ country }) => useLiveServiceExplorer(country, 0, false, "social"),
      { initialProps: { country: "us" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current?.items.map((item) => item.name)).toContain("Available boost");
    rerender({ country: "ng" });
    expect(result.current).toBeNull();
    rerender({ country: "us" });
    expect(result.current).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current).toMatchObject({ country: "us", loading: true, items: [] });
    await act(async () => finish(live()));
    expect(result.current).toMatchObject({ country: "us", loading: false, items: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries eligible feeds without waiting for a different feed's cooldown", async () => {
    vi.useFakeTimers();
    let numberReads = 0;
    let verificationReads = 0;
    const fetchMock = vi.fn((url: string) => {
      const feed = new URL(url, "https://example.test").searchParams.get("feed");
      if (feed === "numbers" && ++numberReads === 1) return Promise.resolve(Response.json({}, { status: 500 }));
      if (feed === "verification" && ++verificationReads === 1) return Promise.resolve(Response.json({}, { status: 429, headers: { "Retry-After": "60" } }));
      return Promise.resolve(live());
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderHook(({ revision }) => useLiveServiceExplorer("us", revision, false), { initialProps: { revision: 0 } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current?.retryBlocked).toBe(false);
    rerender({ revision: 1 });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(numberReads).toBe(2);
    expect(verificationReads).toBe(1);
    expect(result.current?.retryBlocked).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(result.current?.retryBlocked).toBe(false);
    rerender({ revision: 2 });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(verificationReads).toBe(2);
    expect(numberReads).toBe(2);
    expect(result.current?.reason).toBeNull();
  });

  it.each([
    { live: undefined, reason: null },
    { live: "true", reason: null },
    { live: true, reason: "environment" },
    { live: true, reason: "unconfigured" },
  ])("does not present ambiguous availability as live: %j", async ({ live: liveFlag, reason }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      ok: true, country: "us", live: liveFlag, reason, partial: false, items: [social],
    })));
    const { result } = renderHook(() => useLiveServiceExplorer("us", 0, false, "social"));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(result.current).toMatchObject({ live: false, failed: true, partial: true, reason: "error", items: [] });
  });

  it("does not publish rows from a feed reported as unconnected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      ok: true, country: "us", live: false, reason: "unconfigured", items: [social],
    })));
    const { result } = renderHook(() => useLiveServiceExplorer("us", 0, false, "social"));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(result.current?.reason).toBe("unconfigured");
    expect(result.current?.items).toEqual([]);
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
