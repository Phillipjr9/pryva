// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ServiceExplorer } from "@/components/dashboard/ServiceExplorer";
import type { ExplorerItem } from "@/lib/services/service-explorer";

const id = (value: string) => `digital-${value.repeat(24)}`;
const quick = () => screen.getByRole("group", { name: "Quick app and product shortcuts" });

function otp(name: string, number: number, country = "ng", sellable = true): ExplorerItem {
  const publicId = `otp-${number.toString(16).padStart(24, "0")}`;
  return { id: publicId, category: "verification", name, description: "Live app-specific number offer", tag: "Other",
    artwork: { kind: "service", name: "numbers" }, source: "live", coverage: "catalog-country", stock: 7, myUnits: null,
    price: sellable ? 1058 : null, action: sellable ? { label: "Choose service", href: `/dashboard/services/otp/${publicId}?country=${country}` } : null };
}

function boost(platform: string, name: string, number: number, tag = "Followers"): ExplorerItem {
  return { id: `boost-${number}`, category: "social", name, description: "Social promotion", tag, platform,
    artwork: { kind: "service", name: "social-promotion" }, source: "live", coverage: "not-country-specific",
    stock: null, myUnits: null, price: 100, action: { label: "Buy boost", href: `/dashboard/services/boost/boost-${number}` } };
}

function feeds(byCountry: Record<string, Partial<Record<string, ExplorerItem[]>>>) {
  return vi.fn(async (url: string) => {
    const params = new URL(url, "https://pryva.test").searchParams;
    const country = params.get("country") ?? "ng";
    return Response.json({ ok: true, country, live: true, items: byCountry[country]?.[params.get("feed") ?? ""] ?? [] });
  });
}

beforeEach(() => window.history.replaceState(null, "", "/dashboard/services"));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); });

describe("quick app and product discovery", () => {
  it("filters Number plans to the chosen app, retaining every pool, country and guarded checkout", async () => {
    const whatsapp = [otp("WhatsApp", 1), otp("WhatsApp", 2)];
    const fetchMock = feeds({ ng: { verification: [...whatsapp, otp("Telegram", 3), otp("Verification number", 4)] } });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="ng" initialCategory="numbers" />);
    const button = await within(await screen.findByRole("group", { name: "Quick app and product shortcuts" })).findByRole("button", { name: "WhatsApp" });
    expect(within(quick()).queryByRole("button", { name: "Instagram" })).toBeNull();
    expect(within(quick()).queryByRole("button", { name: "Verification number" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Rental" }));
    expect(screen.queryByRole("region", { name: "Apps for single-use numbers" })).toBeNull();
    const callsBefore = fetchMock.mock.calls.length;
    fireEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "All types" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("searchbox", { name: "Search services" })).toHaveProperty("value", "WhatsApp");
    expect(screen.getByRole("combobox", { name: "Country of service" })).toHaveProperty("value", "ng");
    const section = screen.getByRole("region", { name: "Apps for single-use numbers" });
    expect(within(section).getByRole("button", { name: /WhatsApp.*2 options/ })).toBeTruthy();
    expect(within(section).queryByRole("button", { name: /Telegram.*1 option/ })).toBeNull();
    const links = within(section).getAllByRole("link", { name: "Choose service" });
    for (const offer of whatsapp) expect(links.some((link) => link.getAttribute("href") === `${offer.action?.href}&from=numbers`)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(callsBefore);
    fireEvent.click(screen.getByRole("button", { name: "Rental" }));
    expect(screen.getByRole("searchbox", { name: "Search services" })).toHaveProperty("value", "");
    expect(screen.queryByRole("region", { name: "Apps for single-use numbers" })).toBeNull();
    expect(screen.getAllByRole("heading", { name: "Nigeria rental" }).length).toBeGreaterThan(0);
    fireEvent.click(within(quick()).getByRole("button", { name: "WhatsApp" }));
    fireEvent.click(within(quick()).getByRole("button", { name: "Clear quick search" }));
    expect(screen.getByRole("searchbox", { name: "Search services" })).toHaveProperty("value", "");
    expect(within(screen.getByRole("region", { name: "Apps for single-use numbers" })).getByRole("button", { name: /Telegram.*1 option/ })).toBeTruthy();
  });

  it("lets users reveal and select apps beyond the first dozen without dropping the rest", async () => {
    const apps = Array.from({ length: 16 }, (_, index) => otp(`App ${String(index + 1).padStart(2, "0")}`, index + 1));
    vi.stubGlobal("fetch", feeds({ ng: { verification: apps } }));
    render(<ServiceExplorer initialCountry="ng" initialCategory="numbers" />);
    await within(await screen.findByRole("group", { name: "Quick app and product shortcuts" })).findByRole("button", { name: "App 01" });
    expect(within(quick()).queryByRole("button", { name: "App 16" })).toBeNull();
    fireEvent.click(within(quick()).getByRole("button", { name: "Show more shortcuts (4 remaining)" }));
    fireEvent.click(within(quick()).getByRole("button", { name: "App 16" }));
    const section = screen.getByRole("region", { name: "Apps for single-use numbers" });
    expect(within(section).getByRole("button", { name: /App 16.*1 option/ }).getAttribute("aria-expanded")).toBe("true");
    expect(within(section).queryByRole("button", { name: /App 01.*1 option/ })).toBeNull();
    fireEvent.click(within(quick()).getByRole("button", { name: "App 16" }));
    expect(screen.getByRole("searchbox", { name: "Search services" })).toHaveProperty("value", "");
    expect(within(screen.getByRole("region", { name: "Apps for single-use numbers" })).getByRole("button", { name: /App 01.*1 option/ })).toBeTruthy();
  });

  it("handles X / Twitter as an exact platform rather than matching every name containing x", async () => {
    vi.stubGlobal("fetch", feeds({ ng: { social: [boost("X", "X Likes", 1, "Likes"), boost("Twitter", "Twitter Followers", 2), boost("Xbox", "Xbox Followers", 3)] } }));
    render(<ServiceExplorer initialCountry="ng" initialCategory="social" />);
    fireEvent.click(await within(await screen.findByRole("group", { name: "Quick app and product shortcuts" })).findByRole("button", { name: "X / Twitter" }));
    expect(screen.getByRole("searchbox", { name: "Search services" })).toHaveProperty("value", "X / Twitter");
    expect(screen.getByRole("heading", { name: "X Likes" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Twitter Followers" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Xbox Followers" })).toBeNull();
    expect(screen.getAllByRole("link", { name: "Buy boost" }).map((link) => link.getAttribute("href"))).toContain("/dashboard/services/boost/boost-1");
    fireEvent.click(screen.getByRole("button", { name: "Likes" }));
    expect(screen.getByRole("heading", { name: "X Likes" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Twitter Followers" })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search services" }), { target: { value: "Xbox" } });
    expect(within(quick()).getByRole("button", { name: "X / Twitter" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("shows a completed social feed without waiting for an unrelated slow app feed", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const feed = new URL(url, "https://pryva.test").searchParams.get("feed");
      if (feed === "verification") return new Promise<Response>(() => undefined);
      return Response.json({ ok: true, country: "ng", live: true, items: feed === "social" ? [boost("Instagram", "Instagram Followers", 1)] : [] });
    }));
    render(<ServiceExplorer initialCountry="ng" initialCategory="social" />);
    fireEvent.click(await within(await screen.findByRole("group", { name: "Quick app and product shortcuts" })).findByRole("button", { name: "Instagram" }));
    expect(screen.getByRole("heading", { name: "Instagram Followers" })).toBeTruthy();
  });

  it("clears the selected app when changing countries and ignores late results from the previous country", async () => {
    let resolveUS: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async (url: string) => {
      const params = new URL(url, "https://pryva.test").searchParams;
      const country = params.get("country") ?? "ng";
      const feed = params.get("feed");
      if (feed === "verification" && country === "us") return new Promise<Response>((resolve) => { resolveUS = resolve; });
      return Response.json({ ok: true, country, live: true, items: feed === "verification" ? country === "ng" ? [otp("WhatsApp", 1)] : country === "bj" ? [otp("Benin App", 2, "bj", false)] : [] : [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="ng" initialCategory="numbers" />);
    fireEvent.click(await within(await screen.findByRole("group", { name: "Quick app and product shortcuts" })).findByRole("button", { name: "WhatsApp" }));
    fireEvent.click(screen.getByRole("button", { name: "US" }));
    expect(screen.getByRole("searchbox", { name: "Search services" })).toHaveProperty("value", "");
    expect(screen.queryByRole("group", { name: "Quick app and product shortcuts" })).toBeNull();
    await waitFor(() => expect(resolveUS).toBeDefined());
    fireEvent.change(screen.getByRole("combobox", { name: "Country of service" }), { target: { value: "bj" } });
    const benin = await within(await screen.findByRole("group", { name: "Quick app and product shortcuts" })).findByRole("button", { name: "Benin App" });
    await act(async () => resolveUS!(Response.json({ ok: true, country: "us", live: true, items: [otp("Late US App", 3, "us")] })));
    expect(within(quick()).queryByRole("button", { name: "Late US App" })).toBeNull();
    fireEvent.click(benin);
    const section = screen.getByRole("region", { name: "Apps for single-use numbers" });
    expect(within(section).getByRole("button", { name: "Purchasing locked" })).toHaveProperty("disabled", true);
    expect(within(section).queryByRole("link", { name: "Choose service" })).toBeNull();
  });

  it("clears a shortcut when browser history restores another country and category", async () => {
    vi.stubGlobal("fetch", feeds({ ng: { verification: [otp("WhatsApp", 1)] }, us: { verification: [otp("Signal", 2, "us")] } }));
    render(<ServiceExplorer initialCountry="ng" initialCategory="numbers" />);
    fireEvent.click(await within(await screen.findByRole("group", { name: "Quick app and product shortcuts" })).findByRole("button", { name: "WhatsApp" }));
    window.history.pushState(null, "", "/dashboard/services?country=us&category=verification");
    fireEvent.popState(window);
    expect(screen.getByRole("searchbox", { name: "Search services" })).toHaveProperty("value", "");
    expect(screen.getByRole("heading", { level: 1, name: "App verification" })).toBeTruthy();
    expect(await within(await screen.findByRole("group", { name: "Quick app and product shortcuts" })).findByRole("button", { name: "Signal" })).toBeTruthy();
    expect(within(quick()).queryByRole("button", { name: "WhatsApp" })).toBeNull();
  });

  it("does not invent shortcuts while a feed is pending or unconnected, and labels partial results", async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const params = new URL(url, "https://pryva.test").searchParams;
      return params.get("feed") === "verification" ? pending : Response.json({ ok: true, country: "ng", live: true, items: [] });
    }));
    render(<ServiceExplorer initialCountry="ng" initialCategory="numbers" />);
    expect(screen.getByText(/Loading app listings for Nigeria/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Quick app and product shortcuts" })).toBeNull();
    await act(async () => finish(Response.json({ ok: true, country: "ng", live: false, reason: "unconfigured", items: [otp("Not connected", 1)] })));
    expect(await screen.findByText(/App listings are not connected yet/)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Quick app and product shortcuts" })).toBeNull();
    cleanup();

    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const feed = new URL(url, "https://pryva.test").searchParams.get("feed");
      return Response.json(feed === "verification"
        ? { ok: true, country: "ng", live: true, partial: true, items: [otp("Cached App", 1, "ng", false)] }
        : { ok: true, country: "ng", live: true, items: [] });
    }));
    render(<ServiceExplorer initialCountry="ng" initialCategory="numbers" />);
    fireEvent.click(await within(await screen.findByRole("group", { name: "Quick app and product shortcuts" })).findByRole("button", { name: "Cached App" }));
    const section = screen.getByRole("region", { name: "Apps for single-use numbers" });
    expect(within(section).getByText(/App listings may be incomplete or out of date/)).toBeTruthy();
    expect(within(section).getByRole("button", { name: "Purchasing locked" })).toHaveProperty("disabled", true);
  });

  it.each([
    ["subscriptions", "Netflix Premium 1 month", "Netflix"],
    ["games", "Fortnite 500 coins", "Fortnite"],
    ["gift-cards", "Fictional Store Gift Card 20 USD", "Fictional Store"],
    ["prepaid", "Example Wallet 10 USD", "Example Wallet 10 USD"],
  ])("offers loaded product shortcuts in %s without mixing other service categories", (category, name, label) => {
    const product: ExplorerItem = { id: "reviewed-product", category: category as ExplorerItem["category"], name, description: "Product", tag: "Product",
      artwork: { kind: "service", name: "subscriptions" }, source: "catalog", coverage: "unconfirmed", stock: null, myUnits: null, price: null, action: null, orderingPaused: true };
    vi.stubGlobal("fetch", feeds({ ng: {} }));
    render(<ServiceExplorer initialCountry="ng" initialCategory={category} reviewedItems={[product]} />);
    fireEvent.click(within(quick()).getByRole("button", { name: label }));
    const card = screen.getByRole("heading", { name }).closest("article")!;
    expect(within(card).getByRole("button", { name: "Ordering paused" })).toHaveProperty("disabled", true);
    expect(within(card).getAllByText(/Country coverage unconfirmed/).length).toBeGreaterThan(0);
  });

  it("provides provider shortcuts for the loaded email catalogue", async () => {
    const email = (name: string, number: number): ExplorerItem => ({ ...otp(name, number), category: "email", coverage: "not-country-specific", action: null });
    vi.stubGlobal("fetch", feeds({ ng: { numbers: [email("GMX", 1), email("Adobe", 2)] } }));
    render(<ServiceExplorer initialCountry="ng" initialCategory="email" />);
    fireEvent.click(await within(await screen.findByRole("group", { name: "Quick app and product shortcuts" })).findByRole("button", { name: "GMX" }));
    expect(screen.getByRole("heading", { name: "GMX" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Adobe" })).toBeNull();
  });

  it("filters denomination-only top-ups by reviewed identity and keeps paging, stock and checkout guards", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url, "https://pryva.test");
      if (parsed.pathname.endsWith("/subcategories")) return Response.json({ ok: true, categories: [], nextCursor: null });
      if (parsed.pathname !== "/api/services/digital-catalog") return Response.json({ ok: true, country: "ng", live: true, items: [] });
      const params = parsed.searchParams;
      const root = params.get("category");
      const initial = [
        { id: id("a"), name: "Golden Spin", platform: "8 Ball Pool", stock: "reported", checkout: "topups" },
        { id: id("b"), name: "20 Cash", platform: "8 Ball Pool", stock: "out" },
        { id: id("c"), name: "80 + 8 CP", platform: "Call of Duty Mobile", stock: "reported", checkout: "topups" },
      ];
      const next = [{ id: id("d"), name: "5 Scratchers", platform: "8 Ball Pool", stock: "reported", checkout: "topups" }];
      const rows = root === "topups" ? params.has("cursor") ? next : initial : [];
      return Response.json({ ok: true, items: params.has("stock") ? rows.filter((row) => row.stock === "reported") : rows, nextCursor: root === "topups" && !params.has("cursor") ? "page2" : null });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="ng" initialCategory="topups" enableDigitalCatalogue />);
    const group = await screen.findByRole("group", { name: "Quick app and product shortcuts" });
    const pool = await within(group).findByRole("button", { name: "8 Ball Pool" });
    await waitFor(() => expect(screen.queryByText("Loading more service offers…")).toBeNull());
    const callsBefore = fetchMock.mock.calls.length;
    fireEvent.click(pool);
    expect(fetchMock).toHaveBeenCalledTimes(callsBefore);
    expect(screen.getByRole("heading", { name: "Golden Spin" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "80 + 8 CP" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "20 Cash" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load more digital listings" }));
    const nextCard = (await screen.findByRole("heading", { name: "5 Scratchers" })).closest("article")!;
    expect(within(nextCard).getByRole("link", { name: "Check price and availability" }).getAttribute("href")).toBe(`/dashboard/digital-topups?product=${id("d")}`);
    expect(screen.getByRole("heading", { name: "Golden Spin" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Show catalogue listings with reported stock only"));
    const soldOut = (await screen.findByRole("heading", { name: "20 Cash" })).closest("article")!;
    expect(within(soldOut).getByRole("button", { name: "Ordering paused" })).toHaveProperty("disabled", true);
    expect(within(soldOut).getAllByText(/Out of stock \(reported\)/).length).toBeGreaterThan(0);
    expect(within(quick()).getByRole("button", { name: "8 Ball Pool" }).getAttribute("aria-pressed")).toBe("true");
    expect(fetchMock.mock.calls.filter(([url]) => new URL(url, "https://pryva.test").searchParams.has("q"))).toHaveLength(0);
    fireEvent.click(within(screen.getByRole("group", { name: "Browse product types" })).getByRole("button", { name: "Account top-ups" }));
    expect(screen.getByRole("searchbox", { name: "Search services" })).toHaveProperty("value", "");
  });

  it("keeps a whole-catalogue search result when selecting a shortcut from it", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url, "https://pryva.test");
      if (parsed.pathname.endsWith("/categories")) return Response.json({ ok: true, categories: [] });
      if (parsed.pathname === "/api/services/digital-catalog") return Response.json({ ok: true, items: parsed.searchParams.get("q") === "special" ? [{ id: id("e"), name: "Netflix Premium special", stock: "reported", checkout: "codes" }] : [], nextCursor: null });
      return Response.json({ ok: true, country: "ng", live: true, items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="ng" initialCategory={null} enableDigitalCatalogue />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search services" }), { target: { value: "special" } });
    expect(await screen.findByRole("heading", { name: "Netflix Premium special" })).toBeTruthy();
    const netflix = within(quick()).getByRole("button", { name: "Netflix" });
    fireEvent.click(netflix);
    expect(screen.getByRole("heading", { name: "Netflix Premium special" })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search services" })).toHaveProperty("value", "Netflix");
    expect(fetchMock.mock.calls.some(([url]) => new URL(url, "https://pryva.test").searchParams.get("q") === "Netflix")).toBe(false);
  });
});
