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
  it("combines eSIM feeds in the selected-country and all-destinations views", async () => {
    const liveItem = (name: string) => ({ id: `live-${name}`, category: "esim", name, description: "1 GB", tag: "Travel", artwork: { kind: "service", name: "esim" }, source: "live", coverage: "unconfirmed", stock: null, myUnits: null, price: 1000, action: null });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("digital-catalog")) return response({ ok: true, items: [{ id: id("a"), name: "Digital eSIM", stock: "reported" }], nextCursor: null });
      return response({ ok: true, country: "ng", live: true, items: [liveItem(url.includes("allDestinations=1") ? "Other destination" : "Nigeria plan")] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="ng" initialCategory="esim" enableDigitalCatalogue />);
    expect(await screen.findByRole("heading", { name: "Nigeria plan" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Digital eSIM" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Browse all destinations"));
    expect(await screen.findByRole("heading", { name: "Other destination" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Digital eSIM" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Nigeria plan" })).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("feed=esim&allDestinations=1"))).toBe(true);
    fireEvent.click(screen.getByLabelText("Browse all destinations"));
    expect(await screen.findByRole("heading", { name: "Nigeria plan" })).toBeTruthy();
  });
  it("shows offers from both eSIM feeds on the first page without merging their purchase paths", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("digital-catalog")) return response({ ok: true, items: Array.from({ length: 20 }, (_, index) => ({ id: `digital-${index.toString(16).padStart(24, "0")}`, name: `Digital plan ${index}`, stock: "reported", checkout: "esims" })), nextCursor: null });
      return response({ ok: true, country: "ng", live: true, items: [{ id: "live-esim-a", category: "esim", name: "Existing plan", description: "1 GB", tag: "Nigeria", artwork: { kind: "service", name: "esim" }, source: "live", coverage: "catalog-country", stock: null, myUnits: null, price: 1000, action: { label: "Buy eSIM", href: "/dashboard/esim/live-esim-a" } }] });
    }));
    render(<ServiceExplorer initialCountry="ng" initialCategory="esim" enableDigitalCatalogue />);
    const digital = (await screen.findByRole("heading", { name: "Digital plan 0" })).closest("article")!;
    const live = (await screen.findByRole("heading", { name: "Existing plan" })).closest("article")!;
    expect(within(digital).getByRole("link", { name: "Check price and availability" }).getAttribute("href")).toBe(`/dashboard/digital-esims?product=digital-${"0".repeat(24)}`);
    expect(within(live).getByRole("link", { name: "Buy eSIM" }).getAttribute("href")).toBe("/dashboard/esim/live-esim-a");
    expect(within(digital).getAllByText(/region unconfirmed/i).length).toBeGreaterThan(0);
  });
  it("keeps reviewed offers available in their category and avoids duplicating browse results", async () => {
    const { reviewedDigitalItems } = await import("@/lib/services/reviewed-digital-items");
    const reviewed = reviewedDigitalItems([{ id: id("a"), name: "Netflix Gift Card", region: "US", kind: "codes" }, { id: id("b"), name: "Mystery code", region: "US", kind: "codes" }], true);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const root = new URL(url, "https://example.test").searchParams.get("category");
      return response({ ok: true, items: root === "gift-cards" ? [{ id: id("a"), name: "Netflix Gift Card", stock: "out", checkout: "codes" }] : [], nextCursor: null });
    }));
    render(<ServiceExplorer initialCountry="ng" initialCategory="gift-cards" enableDigitalCatalogue reviewedItems={reviewed} giftCardManager={<div>Wallet gift manager</div>} />);
    expect(await screen.findByRole("heading", { name: "Netflix Gift Card" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "Netflix Gift Card" })).toHaveLength(1);
    await waitFor(() => {
      const card = screen.getByRole("heading", { name: "Netflix Gift Card" }).closest("article")!;
      expect(within(card).getByRole("button", { name: "Ordering paused" })).toHaveProperty("disabled", true);
    });
    expect(screen.queryByRole("heading", { name: "Mystery code" })).toBeNull();
    expect(screen.getByText("Wallet gift manager")).toBeTruthy();
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
    fireEvent.click(screen.getByLabelText("Show catalogue listings with reported stock only"));
    const card = (await screen.findByRole("heading", { name: "Call of Duty Xbox 500 Points (GLOBAL)" })).closest("article")!;
    expect(within(card).getAllByText(/Out of stock \(reported\)/i).length).toBeGreaterThan(0);
    expect(within(card).getByRole("button", { name: "Ordering paused" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Load more digital listings" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("cursor=next") && !String(url).includes("category="))).toBe(true));
  });
  it("keeps every catalogue family browseable from the shared All view", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url, "https://example.test");
      if (parsed.pathname.endsWith("/categories")) return response({ ok: true, categories: [{ id: "unknown-family", name: "Other family" }] });
      if (parsed.pathname.endsWith("/subcategories")) return response({ ok: true, categories: [], nextCursor: null });
      return response({ ok: true, items: parsed.searchParams.get("category") === "unknown-family" ? [{ id: id("e"), name: "Other product", stock: "reported" }] : [], nextCursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="ng" initialCategory={null} enableDigitalCatalogue />);
    fireEvent.click(await screen.findByRole("button", { name: "Other family" }));
    expect(await screen.findByRole("heading", { name: "Other product" })).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("category=unknown-family"))).toBe(true);
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
  it("searches loaded listings within the selected category and can search later pages", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const params = new URL(url, "https://example.test").searchParams;
      const next = params.get("cursor") === "next";
      return response({ ok: true, items: params.get("category") === "topups" ? [{ id: next ? id("c") : id("a"), name: next ? "Roblox credit" : "Other credit", stock: "reported" }] : [], nextCursor: params.get("category") === "topups" && !next ? "next" : null });
    });
    vi.stubGlobal("fetch", fetchMock); render(<ServiceExplorer initialCountry="ng" initialCategory="topups" enableDigitalCatalogue />);
    await screen.findByRole("heading", { name: "Other credit" });
    const count = fetchMock.mock.calls.length;
    fireEvent.change(screen.getByLabelText("Search services"), { target: { value: "Roblox" } });
    expect(screen.getByText(/search filters the listings loaded/i)).toBeTruthy();
    expect(fetchMock.mock.calls.length).toBe(count);
    fireEvent.click(screen.getByRole("button", { name: "Load more digital listings" }));
    expect(await screen.findByRole("heading", { name: "Roblox credit" })).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("q=Roblox"))).toBe(false);
  });
  it("finds explicit gift cards in catalogue-wide search without admitting unrelated results", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const params = new URL(url, "https://example.test").searchParams;
      const items = params.get("q") === "Roblox" ? [{ id: id("a"), name: "Roblox Gift Card 25 USD", stock: "reported" }, { id: id("b"), name: "Roblox 100 Robux", stock: "reported" }] : [];
      return response({ ok: true, items, nextCursor: null, searchLimited: false });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="ng" initialCategory="gift-cards" enableDigitalCatalogue />);
    fireEvent.change(screen.getByLabelText("Search services"), { target: { value: "Roblox" } });
    expect(await screen.findByRole("heading", { name: "Roblox Gift Card 25 USD" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Roblox 100 Robux" })).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("q=Roblox"))).toBe(true);
  });
  it("groups gift cards from game currency and the whole catalogue alongside wallet gifts, without treating all games as cards", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const params = new URL(url, "https://example.test").searchParams;
      const root = params.get("category");
      const items = root === "game-currency" ? [
        { id: id("a"), name: "Roblox Gift Card 25 USD", stock: "reported", checkout: "codes" },
        { id: id("b"), name: "Roblox 100 Robux", stock: "reported" },
      ] : root === "gift-cards" ? [{ id: id("c"), name: "Netflix Gift Card", stock: "reported" }]
        : root === null ? [{ id: id("a"), name: "Roblox Gift Card 25 USD", stock: "reported", checkout: "codes" }, { id: id("d"), name: "Other Store Gift Card", stock: "reported" }] : [];
      return response({ ok: true, items, nextCursor: null });
    }));
    render(<ServiceExplorer initialCountry="ng" initialCategory="gift-cards" enableDigitalCatalogue />);
    expect(await screen.findByRole("heading", { name: "Roblox Gift Card 25 USD" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Netflix Gift Card" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Other Store Gift Card" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Roblox 100 Robux" })).toBeNull();
    expect(screen.getAllByRole("heading", { name: "Roblox Gift Card 25 USD" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Manage wallet gift cards" }).getAttribute("href")).toBe("/dashboard/services?category=gift-cards#wallet-gifts");
  });
});
