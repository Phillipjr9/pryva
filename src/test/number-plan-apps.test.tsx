// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ServiceExplorer } from "@/components/dashboard/ServiceExplorer";
import type { ExplorerItem } from "@/lib/services/service-explorer";

function app(name: string, id: string, country = "ng", action = true): ExplorerItem {
  return {
    id: `otp-${id.padStart(24, "0")}`,
    category: "verification",
    name,
    description: "Live app-specific number offer",
    tag: "Other",
    artwork: { kind: "service", name: "numbers" },
    source: "live",
    coverage: "catalog-country",
    stock: 7,
    myUnits: null,
    price: action ? 1058 : null,
    action: action ? { label: "Choose service", href: `/dashboard/services/otp/otp-${id.padStart(24, "0")}?country=${country}` } : null,
    detail: `${country} · single-use verification`,
  };
}

function catalogFetch(offers: Record<string, ExplorerItem[]>) {
  return vi.fn(async (input: string) => {
    const params = new URL(input, "https://pryva.test").searchParams;
    const country = params.get("country")!;
    const feed = params.get("feed");
    return Response.json({
      ok: true, country, live: true, partial: false, fetchedAt: "2026-11-12T12:00:00.000Z",
      items: feed === "verification" ? offers[country] ?? [] : [],
    });
  });
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); });

describe("app-specific offers in Number plans", () => {
  it("shows provider apps alongside the existing plans, preserving every pool and checkout link", async () => {
    const offers = [app("WhatsApp", "1"), app("WhatsApp", "2"), app("Signal", "3")];
    const fetchMock = catalogFetch({ ng: offers });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="ng" initialCategory="numbers" />);

    const section = await screen.findByRole("region", { name: "Apps for single-use numbers" });
    expect(await within(section).findByText(/2 services · 3 offers/)).toBeTruthy();
    expect(within(section).getByRole("button", { name: /WhatsApp.*2 options/ })).toBeTruthy();
    expect(within(section).getByRole("button", { name: /Signal.*1 option/ })).toBeTruthy();
    const whatsapp = within(section).getByRole("button", { name: /WhatsApp.*2 options/ });
    if (whatsapp.getAttribute("aria-expanded") !== "true") fireEvent.click(whatsapp);
    for (const offer of offers.slice(0, 2)) {
      expect(within(section).getAllByRole("link", { name: /Choose service/ }).some((link) => link.getAttribute("href") === `${offer.action?.href}&from=numbers`)).toBe(true);
    }
    expect(screen.getByRole("heading", { name: "Nigeria", level: 3 })).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls.map(([url]) => new URL(url, "https://pryva.test").searchParams.get("feed")).sort()).toEqual(["numbers", "verification"]);
  });

  it("locks unexpected checkout links or links to a different country", async () => {
    const wrongCountry = app("Wrong country", "1", "us");
    const external = { ...app("Unexpected link", "2"), action: { label: "Choose service", href: "https://outside.example/order" } };
    vi.stubGlobal("fetch", catalogFetch({ ng: [wrongCountry, external] }));
    render(<ServiceExplorer initialCountry="ng" initialCategory="numbers" />);
    const section = screen.getByRole("region", { name: "Apps for single-use numbers" });
    for (const name of ["Wrong country", "Unexpected link"]) {
      const button = await within(section).findByRole("button", { name: new RegExp(`${name}.*1 option`) });
      if (button.getAttribute("aria-expanded") !== "true") fireEvent.click(button);
    }
    expect(within(section).getAllByRole("button", { name: "Purchasing locked" })).toHaveLength(2);
    expect(within(section).queryByRole("link", { name: "Choose service" })).toBeNull();
  });

  it("searches all reported apps, paginates by app rather than pool, and keeps number type filters meaningful", async () => {
    const offers = Array.from({ length: 15 }, (_, index) => app(`App ${String(index + 1).padStart(2, "0")}`, String(index + 1)));
    vi.stubGlobal("fetch", catalogFetch({ ng: offers }));
    render(<ServiceExplorer initialCountry="ng" initialCategory="numbers" />);
    const section = await screen.findByRole("region", { name: "Apps for single-use numbers" });
    expect(await within(section).findByRole("button", { name: /App 01.*1 option/ })).toBeTruthy();
    expect(within(section).queryByRole("button", { name: /App 15.*1 option/ })).toBeNull();
    fireEvent.click(within(section).getByRole("button", { name: /Show more apps/ }));
    expect(within(section).getByRole("button", { name: /App 15.*1 option/ })).toBeTruthy();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search services" }), { target: { value: "App 15" } });
    expect(within(section).getByRole("button", { name: /App 15.*1 option/ })).toBeTruthy();
    expect(within(section).queryByRole("button", { name: /App 01.*1 option/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Single use" }));
    expect(within(section).getByRole("button", { name: /App 15.*1 option/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Rental" }));
    expect(screen.queryByRole("region", { name: "Apps for single-use numbers" })).toBeNull();
  });

  it("keeps all options for a single app accessible without hiding other apps", async () => {
    const offers = Array.from({ length: 15 }, (_, index) => app("WhatsApp", String(index + 1)));
    offers.push(app("Call of Duty Mobile", "ff"));
    vi.stubGlobal("fetch", catalogFetch({ ng: offers }));
    render(<ServiceExplorer initialCountry="ng" initialCategory="numbers" />);
    const section = screen.getByRole("region", { name: "Apps for single-use numbers" });
    const whatsapp = await within(section).findByRole("button", { name: /WhatsApp.*15 options/ });
    if (whatsapp.getAttribute("aria-expanded") !== "true") fireEvent.click(whatsapp);
    expect(within(section).getAllByRole("link", { name: "Choose service" })).toHaveLength(12);
    fireEvent.click(within(section).getByRole("button", { name: /More options for WhatsApp/ }));
    const links = within(section).getAllByRole("link", { name: "Choose service" });
    expect(links).toHaveLength(15);
    for (const offer of offers.slice(0, 15)) expect(links.some((link) => link.getAttribute("href") === `${offer.action?.href}&from=numbers`)).toBe(true);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search services" }), { target: { value: "Call of Duty Mobile" } });
    expect(within(section).getByRole("button", { name: /Call of Duty Mobile.*1 option/ })).toBeTruthy();
    expect(within(section).getByRole("link", { name: "Choose service" }).getAttribute("href")).toBe(`${offers[15].action?.href}&from=numbers`);
  });

  it("loads apps for the selected country and never carries results across a country switch", async () => {
    vi.stubGlobal("fetch", catalogFetch({ ng: [app("WhatsApp NG", "1")], us: [app("Signal US", "2", "us")], bj: [app("Benin App", "3", "bj", false)] }));
    render(<ServiceExplorer initialCountry="ng" initialCategory="numbers" />);
    expect(await screen.findByRole("button", { name: /WhatsApp NG.*1 option/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "US" }));
    expect(screen.queryByRole("button", { name: /WhatsApp NG.*1 option/ })).toBeNull();
    expect(await screen.findByRole("button", { name: /Signal US.*1 option/ })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Country of service" }), { target: { value: "bj" } });
    expect(screen.queryByRole("button", { name: /Signal US.*1 option/ })).toBeNull();
    const section = await screen.findByRole("region", { name: "Apps for single-use numbers" });
    const benin = await within(section).findByRole("button", { name: /Benin App.*1 option/ });
    if (benin.getAttribute("aria-expanded") !== "true") fireEvent.click(benin);
    expect(within(section).getByRole("button", { name: "Purchasing locked" }).hasAttribute("disabled")).toBe(true);
    expect(within(section).queryByRole("link", { name: /Choose service/ })).toBeNull();
  });

  it("does not surface rows from a feed that is not connected", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const feed = new URL(input, "https://pryva.test").searchParams.get("feed");
      return Response.json(feed === "verification"
        ? { ok: true, country: "us", live: false, reason: "unconfigured", items: [app("Unconfirmed", "1", "us")] }
        : { ok: true, country: "us", live: true, items: [] });
    }));
    render(<ServiceExplorer initialCountry="us" initialCategory="numbers" />);
    const section = screen.getByRole("region", { name: "Apps for single-use numbers" });
    expect(await within(section).findByText(/App listings are not connected/)).toBeTruthy();
    expect(within(section).queryByText(/Unconfirmed/)).toBeNull();
    expect(within(section).queryByRole("link", { name: "Choose service" })).toBeNull();
  });

  it("distinguishes loading, supplier failure and a genuine empty result even when general plans exist", async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const params = new URL(input, "https://pryva.test").searchParams;
      return params.get("feed") === "verification" ? pending : Response.json({ ok: true, country: "us", live: true, items: [] });
    }));
    render(<ServiceExplorer initialCountry="us" initialCategory="numbers" />);
    const section = screen.getByRole("region", { name: "Apps for single-use numbers" });
    expect(within(section).getByText(/Loading app listings for United States/)).toBeTruthy();
    expect(within(section).queryByText(/No app listings were reported/)).toBeNull();
    await act(async () => finish(Response.json({ ok: true, country: "us", live: true, items: [] })));
    expect(await within(section).findByText(/No app listings were reported for United States/)).toBeTruthy();
    cleanup();

    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const params = new URL(input, "https://pryva.test").searchParams;
      return params.get("feed") === "verification"
        ? Response.json({ error: "unavailable" }, { status: 503, headers: { "Retry-After": "10" } })
        : Response.json({ ok: true, country: "us", live: true, items: [] });
    }));
    render(<ServiceExplorer initialCountry="us" initialCategory="numbers" />);
    const failed = screen.getByRole("region", { name: "Apps for single-use numbers" });
    expect(await within(failed).findByText(/App listings are temporarily unavailable/)).toBeTruthy();
    expect(within(failed).queryByText(/No app listings were reported/)).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("retries a failed app feed without reloading the healthy general-number feed", async () => {
    let attempts = 0;
    const fetchMock = vi.fn(async (input: string) => {
      const params = new URL(input, "https://pryva.test").searchParams;
      if (params.get("feed") !== "verification") return Response.json({ ok: true, country: "us", live: true, items: [] });
      attempts++;
      return Response.json(attempts === 1
        ? { ok: true, country: "us", live: true, partial: true, items: [] }
        : { ok: true, country: "us", live: true, partial: false, items: [app("Signal", "2", "us")] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="us" initialCategory="numbers" />);
    const section = screen.getByRole("region", { name: "Apps for single-use numbers" });
    expect(await within(section).findByText(/App listings are temporarily unavailable/)).toBeTruthy();
    fireEvent.click(within(section).getByRole("button", { name: "Retry apps" }));
    expect(await within(section).findByRole("button", { name: /Signal.*1 option/ })).toBeTruthy();
    const feeds = fetchMock.mock.calls.map(([url]) => new URL(url, "https://pryva.test").searchParams.get("feed"));
    expect(feeds.filter((feed) => feed === "verification")).toHaveLength(2);
    expect(feeds.filter((feed) => feed === "numbers")).toHaveLength(1);
  });

  it("does not block an app retry on an unrelated rental-feed cooldown", async () => {
    let attempts = 0;
    const fetchMock = vi.fn(async (input: string) => {
      const feed = new URL(input, "https://pryva.test").searchParams.get("feed");
      if (feed === "numbers") return Response.json({ reason: "throttled" }, { status: 429, headers: { "Retry-After": "60" } });
      if (feed === "verification") {
        attempts++;
        return Response.json(attempts === 1
          ? { ok: true, country: "us", live: true, partial: true, items: [] }
          : { ok: true, country: "us", live: true, items: [app("Signal", "2", "us")] });
      }
      return Response.json({ ok: true, country: "us", live: true, items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="us" initialCategory="numbers" />);
    const section = screen.getByRole("region", { name: "Apps for single-use numbers" });
    const retry = await within(section).findByRole("button", { name: "Retry apps" });
    expect(retry.hasAttribute("disabled")).toBe(false);
    fireEvent.click(retry);
    expect(await within(section).findByRole("button", { name: /Signal.*1 option/ })).toBeTruthy();
    const feeds = fetchMock.mock.calls.map(([url]) => new URL(url, "https://pryva.test").searchParams.get("feed"));
    expect(feeds.filter((feed) => feed === "numbers")).toHaveLength(1);
  });

  it("keeps throttled cached app offers visibly stale until retry is allowed", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const params = new URL(input, "https://pryva.test").searchParams;
      if (params.get("feed") !== "verification") return Response.json({ ok: true, country: "us", live: true, items: [] });
      return params.get("refresh") === "1"
        ? Response.json({ error: "Please wait" }, { status: 429, headers: { "Retry-After": "60" } })
        : Response.json({ ok: true, country: "us", live: true, partial: true,
          fetchedAt: "2026-11-12T12:00:00.000Z", items: [app("Stale Signal", "2", "us")] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="us" initialCategory="numbers" />);
    const section = screen.getByRole("region", { name: "Apps for single-use numbers" });
    fireEvent.click(await within(section).findByRole("button", { name: "Retry apps" }));
    expect(await within(section).findByText(/App listings were requested too quickly/)).toBeTruthy();
    expect(within(section).getByText(/App listings may be incomplete or out of date/)).toBeTruthy();
    expect(within(section).getByRole("button", { name: /Stale Signal.*1 option/ })).toBeTruthy();
    expect(within(section).getByRole("button", { name: "Retry apps" }).hasAttribute("disabled")).toBe(true);
  });

  it("marks cached app offers as incomplete and observes the retry cooldown", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const params = new URL(input, "https://pryva.test").searchParams;
      return params.get("feed") === "verification"
        ? Response.json({ ok: true, country: "us", live: true, partial: true, reason: "partial",
          fetchedAt: "2026-11-12T12:00:00.000Z", items: [app("Stale Signal", "2", "us")] }, { headers: { "Retry-After": "60" } })
        : Response.json({ ok: true, country: "us", live: true, items: [] });
    }));
    render(<ServiceExplorer initialCountry="us" initialCategory="numbers" />);
    const section = screen.getByRole("region", { name: "Apps for single-use numbers" });
    expect(await within(section).findByText(/App listings may be incomplete or out of date/)).toBeTruthy();
    expect(within(section).getByRole("button", { name: /Stale Signal.*1 option/ })).toBeTruthy();
    expect(within(section).getByText("2026-11-12 12:00:00 UTC")).toBeTruthy();
    expect(within(section).getByRole("button", { name: "Retry apps" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText(/Live listings are current/)).toBeNull();
  });

  it("does not duplicate app offers in the All category", async () => {
    vi.stubGlobal("fetch", catalogFetch({ ng: [app("WhatsApp", "1")] }));
    render(<ServiceExplorer initialCountry="ng" initialCategory="all" />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search services" }), { target: { value: "WhatsApp" } });
    expect(await screen.findByRole("heading", { name: "WhatsApp" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "WhatsApp" })).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "Apps for single-use numbers" })).toBeNull();
  });

  it("does not call a missing app feed current just because another number feed works", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const params = new URL(input, "https://pryva.test").searchParams;
      return Response.json(params.get("feed") === "verification"
        ? { ok: true, country: "us", live: false, reason: "unconfigured", items: [] }
        : { ok: true, country: "us", live: true, items: [] });
    }));
    render(<ServiceExplorer initialCountry="us" initialCategory="numbers" />);
    const section = screen.getByRole("region", { name: "Apps for single-use numbers" });
    expect(await within(section).findByText(/App listings are not connected/)).toBeTruthy();
    expect(within(section).queryByText(/No app listings were reported/)).toBeNull();
    expect(screen.queryByText(/Live listings are current/)).toBeNull();
  });
});
