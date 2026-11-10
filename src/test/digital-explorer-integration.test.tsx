// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ServiceExplorer } from "@/components/dashboard/ServiceExplorer";

const id = (value: string) => `digital-${value.repeat(24)}`;
const response = (data: object, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => data });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("digital listings in service categories", () => {
  it("integrates eSIM products with existing cards, without claiming country coverage or enabling checkout", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("digital-catalog")) return response({ ok: true, items: [{ id: id("a"), name: "Travel plan", stock: "reported" }], nextCursor: null });
      return response({ ok: true, country: "ng", live: true, items: [{ id: "old-esim", category: "esim", name: "Existing eSIM", description: "Travel data", tag: "Travel", artwork: { kind: "service", name: "esim" }, source: "live", coverage: "catalog-country", stock: null, myUnits: null, price: null, action: null }] });
    });
    vi.stubGlobal("fetch", fetchMock); render(<ServiceExplorer initialCountry="ng" initialCategory="esim" enableDigitalCatalogue />);
    const digital = (await screen.findByRole("heading", { name: "Travel plan" })).closest("article")!;
    expect(await screen.findByRole("heading", { name: "Existing eSIM" })).toBeTruthy();
    expect(within(digital).getAllByText(/region unconfirmed/i).length).toBeGreaterThan(0);
    expect(within(digital).getByRole("button", { name: "Ordering paused" }).hasAttribute("disabled")).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("category=esim") && String(url).includes("stock=available"))).toBe(true);
  });
  it("renders curated artwork for generic denomination names on explorer cards", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const root = new URL(url, "https://example.test").searchParams.get("category");
      return response({ ok: true, items: root === "topups" ? [{ id: id("a"), name: "80 + 8 CP", stock: "reported", artwork: { kind: "local", key: "call-of-duty-mobile" } }] : [], nextCursor: null });
    }));
    render(<ServiceExplorer initialCountry="ng" initialCategory="topups" enableDigitalCatalogue />);
    const card = (await screen.findByRole("heading", { name: "80 + 8 CP" })).closest("article")!;
    expect(card.querySelector("img")?.getAttribute("src")).toContain("/digital-brand-icons/call-of-duty-mobile.png");
  });
  it("groups the actual game roots together and loads the next page without losing the first", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const params = new URL(url, "https://example.test").searchParams;
      const root = params.get("category");
      if (root === "games" && params.has("cursor")) return response({ ok: true, items: [{ id: id("b"), name: "Next game", stock: "reported", checkout: "codes" }], nextCursor: null });
      return response({ ok: true, items: root === "games" ? [{ id: id("a"), name: "Game one", stock: "reported" }] : [], nextCursor: root === "games" ? "cursor1" : null });
    });
    vi.stubGlobal("fetch", fetchMock); render(<ServiceExplorer initialCountry="ng" initialCategory="games" enableDigitalCatalogue />);
    expect(await screen.findByRole("heading", { name: "Game one" })).toBeTruthy();
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url), "https://example.test").searchParams.get("category"))).toEqual(expect.arrayContaining(["games", "game-currency", "gaming-services"]));
    fireEvent.click(screen.getByRole("button", { name: "Load more digital listings" }));
    const card = (await screen.findByRole("heading", { name: "Next game" })).closest("article")!;
    expect(screen.getByRole("heading", { name: "Game one" })).toBeTruthy();
    expect(within(card).getByRole("link", { name: "Check price and availability" }).getAttribute("href")).toBe(`/dashboard/digital-codes?product=${id("b")}`);
  });
  it("allows the whole catalogue to be paged, including out-of-stock products", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const params = new URL(url, "https://example.test").searchParams;
      const whole = !params.has("category");
      const items = whole && !params.has("stock") ? [{ id: id("d"), name: "Call of Duty Xbox 500 Points (GLOBAL)", stock: "out" }] : [];
      return response({ ok: true, items, nextCursor: whole && !params.has("cursor") ? "next" : null });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="ng" initialCategory={null} enableDigitalCatalogue />);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("digital-catalog?") && !String(url).includes("category="))).toBe(true));
    fireEvent.click(screen.getByLabelText("Show digital products with reported stock only"));
    const card = (await screen.findByRole("heading", { name: "Call of Duty Xbox 500 Points (GLOBAL)" })).closest("article")!;
    expect(within(card).getAllByText(/Out of stock \(reported\)/i).length).toBeGreaterThan(0);
    expect(within(card).getByRole("button", { name: "Ordering paused" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Load more digital listings" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("cursor=next") && !String(url).includes("category="))).toBe(true));
  });
  it("navigates real product types and lists their descendant products in the relevant service", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url, "https://example.test");
      const params = parsed.searchParams;
      if (parsed.pathname.endsWith("subcategories")) return response({ ok: true, categories: params.get("parent") === "topups" && params.get("name") === "Call of Duty" ? [{ id: "topups-call-of-duty-mobile-activision", name: "Call of Duty Mobile (Activision)" }] : [], nextCursor: null });
      return response({ ok: true, items: params.get("category") === "topups-call-of-duty-mobile-activision" ? [{ id: id("e"), name: "80 + 8 CP", stock: "reported" }] : [], nextCursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="ng" initialCategory="topups" enableDigitalCatalogue />);
    fireEvent.click(within(screen.getByRole("group", { name: "Browse product types" })).getByRole("button", { name: "Account top-ups" }));
    fireEvent.change(screen.getByLabelText("Find a product type"), { target: { value: "Call of Duty" } });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    fireEvent.click(await screen.findByRole("button", { name: "Call of Duty Mobile (Activision)" }));
    const card = (await screen.findByRole("heading", { name: "80 + 8 CP" })).closest("article")!;
    expect(within(card).getByRole("button", { name: "Ordering paused" }).hasAttribute("disabled")).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("category=topups-call-of-duty-mobile-activision"))).toBe(true);
  });
  it("keeps partial results and reports failures without inventing stock", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const root = new URL(url, "https://example.test").searchParams.get("category");
      return root === "games" ? response({ ok: true, items: [{ id: id("a"), name: "Game one", stock: "reported" }], nextCursor: null }) : response({ error: "secret" }, false);
    }));
    render(<ServiceExplorer initialCountry="ng" initialCategory="games" enableDigitalCatalogue />);
    expect(await screen.findByRole("heading", { name: "Game one" })).toBeTruthy();
    expect((await screen.findByText(/Some listings could not be loaded/)).textContent).not.toContain("secret");
  });
  it("searches across all catalogue categories instead of only the exact root", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const params = new URL(url, "https://example.test").searchParams;
      return response({ ok: true, items: params.get("q") === "Roblox" ? [{ id: id("c"), name: "Roblox credit", stock: "reported" }] : [], nextCursor: null, searchLimited: true });
    });
    vi.stubGlobal("fetch", fetchMock); render(<ServiceExplorer initialCountry="ng" initialCategory="topups" enableDigitalCatalogue />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Search services"), { target: { value: "Roblox" } });
    expect(await screen.findByRole("heading", { name: "Roblox credit" })).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("q=Roblox"))).toBe(true);
    expect(screen.getByText(/search is limited to 50/i)).toBeTruthy();
    const searchUrl = String(fetchMock.mock.calls.find(([url]) => String(url).includes("q=Roblox"))?.[0]);
    expect(new URL(searchUrl, "https://example.test").searchParams.has("category")).toBe(false);
    expect(screen.getByText(/include all product categories/)).toBeTruthy();
  });
});
