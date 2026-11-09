// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DigitalCatalogBrowser } from "@/app/dashboard/digital-catalog/DigitalCatalogBrowser";
import { AvailableDigitalProducts } from "@/app/dashboard/digital-catalog/AvailableDigitalProducts";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
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
  it("links approved listings to the correct product quote", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => url.endsWith("/categories")
      ? reply({ ok: true, categories: [] })
      : reply({ ok: true, items: [{ id: "digital-abc", name: "Game", checkout: "topups" }], nextCursor: null, searchLimited: false, skipped: false })));
    render(<DigitalCatalogBrowser />);
    expect((await screen.findByRole("link", { name: "Check price and availability" })).getAttribute("href")).toBe("/dashboard/digital-topups?product=digital-abc");
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
