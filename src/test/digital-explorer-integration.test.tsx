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
    render(<ServiceExplorer initialCountry="ng" initialCategory="gift-cards" enableDigitalCatalogue reviewedItems={reviewed} />);
    expect(await screen.findByRole("heading", { name: "Netflix Gift Card" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "Netflix Gift Card" })).toHaveLength(1);
    await waitFor(() => {
      const card = screen.getByRole("heading", { name: "Netflix Gift Card" }).closest("article")!;
      expect(within(card).getByRole("button", { name: "Ordering paused" })).toHaveProperty("disabled", true);
    });
    expect(screen.queryByRole("heading", { name: "Mystery code" })).toBeNull();
    expect(screen.queryByText("Wallet gift manager")).toBeNull();
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
  it("shows each screenshot top-up's own local game icon while keeping unknown items neutral", async () => {
    const poolNames = ["Golden Spin", "5 Scratchers", "20 000 Coins", "20 Cash", "3 Golden Shots"];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const root = new URL(url, "https://example.test").searchParams.get("category");
      const items = [
        { id: id("a"), name: "3550 Coins (40% more value)", stock: "reported", artwork: { kind: "category", key: "oxide-survival-island" } },
        ...poolNames.map((name, index) => ({ id: `digital-${(index + 1).toString(16).padStart(24, "0")}`, name, stock: "reported", checkout: "topups", artwork: { kind: "category", key: "8-ball-pool" } })),
        { id: id("b"), name: "Unknown 20 Coins", stock: "reported", artwork: { kind: "category", key: "https://evil.test/tracker" } },
      ];
      return response({ ok: true, items: root === "topups" ? items : [], nextCursor: null });
    }));
    render(<ServiceExplorer initialCountry="ng" initialCategory="topups" enableDigitalCatalogue />);
    const oxide = (await screen.findByRole("heading", { name: "3550 Coins (40% more value)" })).closest("article")!;
    expect(oxide.querySelector("img")?.getAttribute("src")).toBe("/digital-game-icons/oxide-survival-island.webp");
    for (const name of poolNames) {
      const card = (await screen.findByRole("heading", { name })).closest("article")!;
      expect(card.querySelector("img")?.getAttribute("src")).toBe("/digital-game-icons/8-ball-pool.webp");
      expect(within(card).getByRole("link", { name: "Check price and availability" }).getAttribute("href")).toContain("/dashboard/digital-topups?product=digital-");
    }
    const unknown = (await screen.findByRole("heading", { name: "Unknown 20 Coins" })).closest("article")!;
    expect(unknown.querySelector("img")).toBeNull();
    expect(unknown.querySelector("svg")).toBeTruthy();
    expect(within(unknown).getByRole("button", { name: "Ordering paused" })).toHaveProperty("disabled", true);
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
  it("explains an unconnected catalogue instead of offering a retry that cannot work", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (new URL(url, "https://example.test").pathname === "/api/services/digital-catalog") {
        return Response.json({ code: "unconfigured", error: "Not connected" }, { status: 503, headers: { "Retry-After": "60" } });
      }
      return response({ ok: true, country: "ng", live: true, items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="ng" initialCategory="subscriptions" enableDigitalCatalogue />);
    expect(await screen.findByText(/Digital catalogue is not connected yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry catalogue" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => new URL(String(url), "https://example.test").pathname === "/api/services/digital-catalog")).toHaveLength(2);
  });

  it("keeps available digital listings visible and explains a throttle", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url, "https://example.test");
      if (parsed.pathname === "/api/services/digital-catalog") {
        if (parsed.searchParams.get("category") === "games") return Response.json({ ok: true, items: [{ id: id("a"), name: "Game one", stock: "reported" }], nextCursor: null });
        return Response.json({ error: "Please wait" }, { status: 429, headers: { "Retry-After": "60" } });
      }
      return response({ ok: true, country: "ng", live: true, items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="ng" initialCategory="games" enableDigitalCatalogue />);
    expect(await screen.findByRole("heading", { name: "Game one" })).toBeTruthy();
    expect(await screen.findByText(/Digital listings were requested too quickly/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry catalogue" })).toHaveProperty("disabled", true);
    expect(screen.getByText(/Please wait for the cooldown to finish/)).toBeTruthy();
    const digitalCalls = fetchMock.mock.calls.filter(([url]) => new URL(String(url), "https://example.test").pathname === "/api/services/digital-catalog");
    expect(digitalCalls).toHaveLength(4);
  });

  it("retries only failed shelves without hiding previously loaded listings", async () => {
    let retrying = false;
    let finishRetry: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url, "https://example.test");
      if (parsed.pathname !== "/api/services/digital-catalog") return response({ ok: true, items: [] });
      const root = parsed.searchParams.get("category");
      if (root === "games") return Response.json({ ok: true, items: [{ id: id("a"), name: "Game one", stock: "reported" }], nextCursor: null });
      if (root === "game-currency" && !retrying) return Response.json({ error: "unavailable" }, { status: 500 });
      if (root === "game-currency") return new Promise<Response>((resolve) => { finishRetry = resolve; });
      return Response.json({ ok: true, items: [], nextCursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="ng" initialCategory="games" enableDigitalCatalogue />);
    expect(await screen.findByRole("heading", { name: "Game one" })).toBeTruthy();
    const retry = await screen.findByRole("button", { name: "Retry catalogue" });
    await waitFor(() => expect(retry).toHaveProperty("disabled", false));
    retrying = true;
    fireEvent.click(retry);
    await waitFor(() => expect(finishRetry).toBeDefined());
    expect(screen.getByRole("heading", { name: "Game one" })).toBeTruthy();
    finishRetry!(Response.json({ ok: true, items: [{ id: id("b"), name: "Game two", stock: "reported" }], nextCursor: null }));
    expect(await screen.findByRole("heading", { name: "Game two" })).toBeTruthy();
    const calls = fetchMock.mock.calls.map(([url]) => new URL(String(url), "https://example.test"))
      .filter((url) => url.pathname === "/api/services/digital-catalog");
    expect(calls.filter((url) => url.searchParams.get("category") === "games")).toHaveLength(1);
    expect(calls.filter((url) => url.searchParams.get("category") === "game-currency")).toHaveLength(2);
    expect(calls.filter((url) => url.searchParams.get("category") === "gaming-services")).toHaveLength(1);
    expect(calls.filter((url) => !url.searchParams.has("category"))).toHaveLength(1);
  });

  it("retries a failed later page without losing or reloading earlier pages", async () => {
    let retrying = false;
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url, "https://example.test");
      if (parsed.pathname !== "/api/services/digital-catalog") return response({ ok: true, items: [] });
      if (parsed.searchParams.get("category") !== "games") return Response.json({ ok: true, items: [], nextCursor: null });
      if (!parsed.searchParams.has("cursor")) return Response.json({ ok: true, items: [{ id: id("a"), name: "Game one", stock: "reported" }], nextCursor: "next" });
      if (!retrying) return Response.json({ error: "unavailable" }, { status: 500 });
      return Response.json({ ok: true, items: [{ id: id("b"), name: "Game two", stock: "reported" }], nextCursor: null });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="ng" initialCategory="games" enableDigitalCatalogue />);
    expect(await screen.findByRole("heading", { name: "Game one" })).toBeTruthy();
    const more = await screen.findByRole("button", { name: "Load more digital listings" });
    await waitFor(() => expect(more).toHaveProperty("disabled", false));
    fireEvent.click(more);
    const retry = await screen.findByRole("button", { name: "Retry catalogue" });
    await waitFor(() => expect(retry).toHaveProperty("disabled", false));
    retrying = true;
    fireEvent.click(retry);
    expect(await screen.findByRole("heading", { name: "Game two" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Game one" })).toBeTruthy();
    const calls = fetchMock.mock.calls.map(([url]) => new URL(String(url), "https://example.test"))
      .filter((url) => url.pathname === "/api/services/digital-catalog" && url.searchParams.get("category") === "games");
    expect(calls.filter((url) => !url.searchParams.has("cursor"))).toHaveLength(1);
    expect(calls.filter((url) => url.searchParams.get("cursor") === "next")).toHaveLength(2);
  });

  it("keeps partial results and reports failures without inventing stock", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const root = new URL(url, "https://example.test").searchParams.get("category");
      return root === "games" ? response({ ok: true, items: [{ id: id("a"), name: "Game one", stock: "reported" }], nextCursor: null }) : response({ error: "secret" }, false);
    }));
    render(<ServiceExplorer initialCountry="ng" initialCategory="games" enableDigitalCatalogue />);
    expect(await screen.findByRole("heading", { name: "Game one" })).toBeTruthy();
    expect((await screen.findByText(/Some listings could not be loaded/, {}, { timeout: 4000 })).textContent).not.toContain("secret");
  });
  it("searches loaded listings within the selected category and can search later pages", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const params = new URL(url, "https://example.test").searchParams;
      const next = params.get("cursor") === "next";
      return response({ ok: true, items: params.get("category") === "topups" ? [{ id: next ? id("c") : id("a"), name: next ? "Later account credit" : "Other credit", stock: "reported" }] : [], nextCursor: params.get("category") === "topups" && !next ? "next" : null });
    });
    vi.stubGlobal("fetch", fetchMock); render(<ServiceExplorer initialCountry="ng" initialCategory="topups" enableDigitalCatalogue />);
    await screen.findByRole("heading", { name: "Other credit" });
    const count = fetchMock.mock.calls.length;
    fireEvent.change(screen.getByLabelText("Search services"), { target: { value: "Later" } });
    expect(screen.getByText(/search filters the listings loaded/i)).toBeTruthy();
    expect(fetchMock.mock.calls.length).toBe(count);
    fireEvent.click(screen.getByRole("button", { name: "Load more digital listings" }));
    expect(await screen.findByRole("heading", { name: "Later account credit" })).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("q=Later"))).toBe(false);
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
  it("groups gift cards from game currency and the whole catalogue without treating all games as cards", async () => {
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
    expect(screen.queryByRole("link", { name: "Manage wallet gift cards" })).toBeNull();
  });
});

it("shows reported gift-card terms as unconfirmed, not a retail price or eligibility guarantee", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const root = new URL(url, "https://example.test").searchParams.get("category");
    return response({ ok: true, items: root === "gift-cards" ? [{ id: id("e"), name: "Example Gift Card", stock: "reported", reportedTerms: { country: "US", value: { amount: 25, currency: "USD" } } }] : [], nextCursor: null });
  }));
  render(<ServiceExplorer initialCountry="ng" initialCategory="gift-cards" enableDigitalCatalogue />);
  const card = (await screen.findByRole("heading", { name: "Example Gift Card" })).closest("article")!;
  expect(within(card).getAllByText(/Reported value: 25 USD/).length).toBeGreaterThan(0);
  expect(within(card).getAllByText(/Reported country: US/).length).toBeGreaterThan(0);
  expect(within(card).getAllByText(/Redemption eligibility unconfirmed/).length).toBeGreaterThan(0);
  expect(within(card).getByText("See details")).toBeTruthy();
});

it("finds subscription codes via catalogue search without displaying unrelated matches", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const params = new URL(url, "https://example.test").searchParams;
    return response({ ok: true, items: params.get("q") === "Disney" ? [
      { id: id("a"), name: "Disney+ 3 months", stock: "reported", checkout: "codes" },
      { id: id("b"), name: "Disney game key", stock: "reported" },
    ] : [], nextCursor: null });
  }));
  render(<ServiceExplorer initialCountry="ng" initialCategory="subscriptions" enableDigitalCatalogue />);
  fireEvent.change(screen.getByLabelText("Search services"), { target: { value: "Disney" } });
  expect(await screen.findByRole("heading", { name: "Disney+ 3 months" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Disney game key" })).toBeNull();
});

it("includes off-shelf VPN and productivity subscriptions without importing gaming packs", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const params = new URL(url, "https://example.test").searchParams;
    return response({ ok: true, items: !params.get("category") ? [
      { id: id("a"), name: "NordVPN 12 months", stock: "reported", checkout: "codes" },
      { id: id("b"), name: "Google One 2TB", stock: "reported" },
      { id: id("c"), name: "PUBG Premium currency pack", stock: "reported" },
    ] : [], nextCursor: null });
  }));
  render(<ServiceExplorer initialCountry="ng" initialCategory="subscriptions" enableDigitalCatalogue />);
  expect(await screen.findByRole("heading", { name: "NordVPN 12 months" })).toBeTruthy();
  expect(await screen.findByRole("heading", { name: "Google One 2TB" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "PUBG Premium currency pack" })).toBeNull();
});
