// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DigitalCatalogBrowser } from "@/app/dashboard/digital-catalog/DigitalCatalogBrowser";
import { AvailableDigitalProducts } from "@/app/dashboard/digital-catalog/AvailableDigitalProducts";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const reply = (data: object, status = 200) => ({ ok: status === 200, json: async () => data });

describe("digital catalogue browser", () => {
  it("paginates and searches without creating an order", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/categories")) return reply({ ok: true, categories: [{ id: "esim", name: "eSIM" }] });
      const params = new URL(url, "https://example.test").searchParams;
      if (params.has("q")) return reply({ ok: true, items: [{ id: "2", name: "Telegram Stars" }], nextCursor: null, searchLimited: true, skipped: false });
      if (params.has("cursor")) return reply({ ok: true, items: [{ id: "3", name: "Game credit" }], nextCursor: null, searchLimited: false, skipped: false });
      return reply({ ok: true, items: [{ id: "1", name: "Subscription" }], nextCursor: "next", searchLimited: false, skipped: false });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<DigitalCatalogBrowser />);
    expect(await screen.findByText("Subscription")).toBeTruthy();
    expect(screen.getByText("Not available to order")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Game credit")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(await screen.findByText("Subscription")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Game credit")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search digital products"), { target: { value: "Telegram" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("Telegram Stars")).toBeTruthy();
    expect(screen.getByText(/more matches may exist/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Browse by category"), { target: { value: "esim" } });
    await screen.findByText("Subscription");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("category=esim"))).toBe(true);
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith("/api/services/digital-catalog"))).toBe(true);
  });
  it("shows reported stock separately from checkout and resets pagination when the stock filter changes", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/categories")) return reply({ ok: true, categories: [] });
      const params = new URL(url, "https://example.test").searchParams;
      if (params.has("cursor")) return reply({ ok: true, items: [{ id: "b", name: "Page two", stock: "reported" }], nextCursor: null, searchLimited: false, skipped: false });
      return reply({ ok: true, items: [{ id: "a", name: "Game", stock: params.has("stock") ? "reported" : "out" }], nextCursor: "next", searchLimited: false, skipped: false });
    });
    vi.stubGlobal("fetch", fetchMock); render(<DigitalCatalogBrowser />);
    expect(await screen.findByText("Stock reported")).toBeTruthy();
    expect(screen.getByText("Not available to order")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next page" })); await screen.findByText("Page two");
    fireEvent.click(screen.getByLabelText("Show listings with reported stock only"));
    expect(await screen.findByText("Out of stock (reported)")).toBeTruthy();
    const last = String(fetchMock.mock.calls.at(-1)?.[0]);
    expect(last).not.toContain("cursor="); expect(last).not.toContain("stock=");
    expect((screen.getByRole("button", { name: "Previous" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("links approved listings to the correct product quote", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => url.endsWith("/categories")
      ? reply({ ok: true, categories: [] })
      : reply({ ok: true, items: [{ id: "digital-abc", name: "Game", checkout: "topups" }], nextCursor: null, searchLimited: false, skipped: false })));
    render(<DigitalCatalogBrowser />);
    expect((await screen.findByRole("link", { name: "Check price and availability" })).getAttribute("href")).toBe("/dashboard/digital-topups?product=digital-abc");
  });
  it("does not offer a pointless retry for an unconnected regional catalogue", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: "This catalogue is not connected yet.", code: "unconfigured" }, { status: 503, headers: { "Retry-After": "60" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<DigitalCatalogBrowser fixedCategory="games" />);
    expect((await screen.findByRole("alert")).textContent).toContain("not connected yet");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous page visible while a throttled next page awaits retry", async () => {
    vi.useFakeTimers();
    let finishRetry: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ ok: true, items: [{ id: "1", name: "First game", stock: "reported" }], nextCursor: "next", searchLimited: false, skipped: false }))
      .mockResolvedValueOnce(new Response("busy", { status: 429, headers: { "Retry-After": "6" } }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishRetry = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<DigitalCatalogBrowser fixedCategory="games" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("First game")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Next page" })); });
    expect(screen.getByText("First game")).toBeTruthy();
    expect(screen.getByText(/previously loaded page is shown/)).toBeTruthy();
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry).toHaveProperty("disabled", true);
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(retry).toHaveProperty("disabled", false);
    await act(async () => { fireEvent.click(retry); });
    expect(screen.getByText("First game")).toBeTruthy();
    expect(finishRetry).toBeDefined();
    await act(async () => { finishRetry!(Response.json({ ok: true, items: [{ id: "2", name: "Second game", stock: "reported" }], nextCursor: null, searchLimited: false, skipped: false })); });
    expect(screen.getByText("Second game")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2][0])).toContain("cursor=next");
  });

  it("reports provider errors and can retry", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/categories")) return reply({ ok: true, categories: [] });
      return fetchMock.mock.calls.filter(([called]) => !String(called).endsWith("/categories")).length === 1 ? reply({ error: "Catalogue unavailable." }, 503) : reply({ ok: true, items: [], nextCursor: null, searchLimited: false, skipped: false });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<DigitalCatalogBrowser />);
    expect((await screen.findByRole("alert")).textContent).toContain("Catalogue unavailable.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/No listings returned/)).toBeTruthy();
  });
});


describe("configured digital products", () => {
  const offers = [
    { id: "digital-one", name: "Game voucher", region: "United States", kind: "codes" as const },
    { id: "digital-two", name: "Travel plan", region: "Japan", kind: "esims" as const },
    { id: "digital-three", name: "Game coins", region: "Europe", kind: "topups" as const },
  ];
  it("shows configured products with quote links, and filters by type and region", () => {
    render(<AvailableDigitalProducts offers={offers} starsEnabled />);
    expect(screen.getByText("Telegram Stars")).toBeTruthy();
    expect(screen.getByText("Travel eSIM · Japan")).toBeTruthy();
    const links = screen.getAllByRole("link", { name: "Check price and availability" });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/dashboard/telegram-stars", "/dashboard/digital-codes?product=digital-one", "/dashboard/digital-esims?product=digital-two", "/dashboard/digital-topups?product=digital-three",
    ]);
    fireEvent.change(screen.getByLabelText("Product type"), { target: { value: "esims" } });
    expect(screen.queryByText("Game voucher")).toBeNull();
    expect(screen.queryByText("Telegram Stars")).toBeNull();
    fireEvent.change(screen.getByLabelText("Find a product or region"), { target: { value: "japan" } });
    expect(screen.getByText("Travel plan")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Find a product or region"), { target: { value: "canada" } });
    expect(screen.getByText("No configured products match your search.")).toBeTruthy();
  });
  it("shows an honest empty state without checkout links when no products are configured", () => {
    render(<AvailableDigitalProducts offers={[]} starsEnabled={false} />);
    expect(screen.getByText(/No digital products are currently configured for checkout/)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("allows all configured products to be reached beyond the first page", () => {
    const many = Array.from({ length: 26 }, (_, index) => ({ id: `digital-${index}`, name: `Product ${index}`, region: "Global", kind: "codes" as const }));
    render(<AvailableDigitalProducts offers={many} starsEnabled={false} />);
    expect(screen.queryByText("Product 25")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show more products" }));
    expect(screen.getByText("Product 25")).toBeTruthy();
  });
});
