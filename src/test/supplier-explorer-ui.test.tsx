// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ServiceExplorer } from "@/components/dashboard/ServiceExplorer";

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); });

describe("service explorer live listings", () => {
  it("does not report zero app listings while that feed is still loading", async () => {
    let finishOtp!: (response: unknown) => void;
    const pending = new Promise((resolve) => { finishOtp = resolve; });
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (new URL(url, "https://pryva.test").searchParams.get("feed") === "verification") return pending;
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, country: "us", live: true, items: [] }) });
    }));
    render(<ServiceExplorer initialCountry="us" initialCategory="verification" />);
    expect(await screen.findByText(/Loading app verification listings/)).toBeTruthy();
    expect(screen.queryByText(/0 listings · United States selected/)).toBeNull();
    expect(screen.queryByText("No listings match these filters")).toBeNull();
    expect(screen.queryByText(/No app verification listings were reported/)).toBeNull();
    await act(async () => { finishOtp({ ok: true, json: async () => ({ ok: true, country: "us", live: true, items: [{
      id: "otp-sample", category: "verification", name: "WhatsApp", description: "Live offer", tag: "Messaging",
      artwork: { kind: "service", name: "numbers" }, source: "live", coverage: "catalog-country", stock: 7, myUnits: null, price: null, action: null,
    }] }) }); });
    expect(await screen.findByRole("heading", { name: "WhatsApp" })).toBeTruthy();
    expect(screen.getByText(/1 listing · United States selected/)).toBeTruthy();
  });

  it("shows a genuine empty result only after a successful verification read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, country: "us", live: true, items: [] }) }));
    render(<ServiceExplorer initialCountry="us" initialCategory="verification" />);
    expect(await screen.findByText(/No app verification listings were reported for United States/)).toBeTruthy();
    expect(screen.getByText(/0 listings · United States selected/)).toBeTruthy();
  });

  it("does not describe a verification feed failure as zero inventory", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ reason: "unavailable" }), {
      status: 503, headers: { "content-type": "application/json", "retry-after": "10" },
    })));
    render(<ServiceExplorer initialCountry="us" initialCategory="verification" />);
    expect(await screen.findByText(/App verification listings are unavailable right now/)).toBeTruthy();
    expect(screen.queryByText(/0 listings · United States selected/)).toBeNull();
    expect(screen.queryByText(/No app verification listings were reported/)).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("labels throttled cached verification listings as incomplete and holds retry until the cooldown", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      const feed = new URL(url, "https://pryva.test").searchParams.get("feed");
      const data = feed === "verification" ? { ok: true, country: "us", live: true, partial: true, reason: "partial",
        fetchedAt: "2026-01-01T12:34:56.000Z", items: [{
          id: "otp-stale", category: "verification", name: "Stale WhatsApp", description: "Live offer", tag: "Messaging",
          artwork: { kind: "service", name: "numbers" }, source: "live", coverage: "catalog-country", stock: 3, myUnits: null, price: null, action: null,
        }] } : { ok: true, country: "us", live: true, items: [] };
      return Promise.resolve(Response.json(data, { headers: { "retry-after": "60" } }));
    }));
    render(<ServiceExplorer initialCountry="us" initialCategory="verification" />);
    expect(await screen.findByRole("heading", { name: "Stale WhatsApp" })).toBeTruthy();
    expect(screen.getByText(/Live listings may be incomplete or out of date/)).toBeTruthy();
    expect(screen.queryByText(/Live listings are current/)).toBeNull();
    expect(screen.getByText("2026-01-01 12:34:56 UTC")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" }).hasAttribute("disabled")).toBe(true);
  });

  it("renders a fast feed while another is pending, then reuses it when switching categories", async () => {
    let finishOtp!: (response: unknown) => void;
    const pending = new Promise((resolve) => { finishOtp = resolve; });
    const fetchMock = vi.fn((url: string) => {
      const feed = new URL(url, "https://pryva.test").searchParams.get("feed");
      if (feed === "verification") return pending;
      const items = feed === "social" ? [{
        id: "live-boost-fast", category: "social", name: "Fast Instagram boost", description: "Followers boost", tag: "Followers",
        artwork: { kind: "brand", name: "instagram" }, source: "live", coverage: "not-country-specific", stock: null, myUnits: null, price: 1600, action: null,
      }] : [];
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, country: "us", live: true, partial: false, items }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="us" initialCategory={null} />);
    expect(await screen.findByRole("heading", { name: "Fast Instagram boost" })).toBeTruthy();
    expect(screen.getByText(/Live listings are still loading/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await act(async () => { finishOtp({ ok: true, json: async () => ({ ok: true, country: "us", live: true, items: [] }) }); });
    expect(await screen.findByText(/Live listings are current/)).toBeTruthy();
    const social = screen.getAllByRole("button", { name: /Social promotion/i }).find((button) => button.hasAttribute("aria-pressed"));
    expect(social).toBeTruthy();
    fireEvent.click(social!);
    expect(await screen.findByRole("heading", { name: "Fast Instagram boost" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("keeps successful listings visible and reports a failed feed", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      const feed = new URL(url, "https://pryva.test").searchParams.get("feed");
      if (feed === "verification") return Promise.resolve({ ok: false, status: 503, json: async () => ({}) });
      const items = feed === "social" ? [{ id: "fast", category: "social", name: "Available boost", description: "Boost", tag: "Followers", artwork: { kind: "brand", name: "instagram" }, source: "live", coverage: "not-country-specific", stock: null, myUnits: null, price: null, action: null }] : [];
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, country: "us", live: true, items }) });
    }));
    render(<ServiceExplorer initialCountry="us" initialCategory={null} />);
    expect(await screen.findByRole("heading", { name: "Available boost" })).toBeTruthy();
    expect(await screen.findByText(/Some live listings could not be loaded/, {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByText(/Live listings may be incomplete or out of date/)).toBeTruthy();
  });

  it("ignores a response for the previous country even if fetch does not honor abort", async () => {
    let finishOld!: (response: unknown) => void;
    const pending = new Promise((resolve) => { finishOld = resolve; });
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("country=us")) return pending;
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, country: "ng", live: true, items: [] }) });
    }));
    render(<ServiceExplorer initialCountry="us" initialCategory="verification" />);
    fireEvent.change(screen.getByRole("combobox", { name: "Country of service" }), { target: { value: "ng" } });
    await act(async () => { finishOld({ ok: true, json: async () => ({ ok: true, country: "us", live: true, items: [{ id: "old", name: "Old country item", category: "verification" }] }) }); });
    expect(screen.queryByRole("heading", { name: "Old country item" })).toBeNull();
  });

  it("uses the saved default country and labels stock, indicative price and paused ordering", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      ok: true, country: "us", partial: false, fetchedAt: "2026-01-01T12:34:56.000Z", items: [{
        id: "live-sms-test", category: "verification", name: "Example live app", description: "SMS verification listing", tag: "Other",
        artwork: { kind: "service", name: "numbers" }, source: "live", coverage: "catalog-country", stock: 7, myUnits: null, price: 1250, action: null,
      }],
    }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry={null} initialCategory="verification" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/services/catalog?country=ng");
    fireEvent.click(screen.getByRole("button", { name: "US" }));
    const card = (await screen.findByRole("heading", { name: "Example live app" })).closest("article")!;
    expect(within(card).getByText("Live listing")).toBeTruthy();
    expect(within(card).getByText("Reported region: United States")).toBeTruthy();
    expect(within(card).getByText("Indicative price ₦1,250")).toBeTruthy();
    expect(within(card).getAllByText("7 left").length).toBeGreaterThan(0);
    expect(within(card).getByText("Not tracked")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Purchasing locked" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Live listings are current/)).toBeTruthy();
    expect(screen.getByText("2026-01-01 12:34:56 UTC")).toBeTruthy();
  });

  it("links a priced boost straight into its purchase page", async () => {
    // Boosts are the one live listing that can actually be bought: no country
    // gate, a "from" price, and a link — not a disabled button.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      ok: true, country: "ng", partial: false, fetchedAt: "2026-01-01T12:34:56.000Z", items: [{
        id: "live-boost-0123456789abcdef0123", category: "social", name: "Instagram Followers", description: "Followers boost",
        tag: "Followers", artwork: { kind: "brand", name: "instagram" }, source: "live", coverage: "not-country-specific",
        stock: null, myUnits: null, price: 1600, priceFrom: true,
        action: { label: "Buy boost", href: "/dashboard/services/boost/live-boost-0123456789abcdef0123" },
      }],
    }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="ng" initialCategory="social" />);
    const card = (await screen.findByRole("heading", { name: "Instagram Followers" })).closest("article")!;
    const buy = within(card).getByRole("link", { name: /Buy boost/ });
    expect(buy.getAttribute("href")).toBe("/dashboard/services/boost/live-boost-0123456789abcdef0123");
    expect(within(card).getByText(/from ₦1,600/)).toBeTruthy();
  });

  it("requests the live catalog and never a demo endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, country: "us", items: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="us" initialCategory="verification" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/services/catalog?country=us");
    // The demo inventory endpoint was deleted with the demo subsystem.
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("/demo/"))).toBe(true);
    expect(screen.queryByText(/Demo catalog/)).toBeNull();
  });

  it("says live availability is off instead of offering a retry that cannot work", async () => {
    // The endpoint answers 200 with live:false when the environment is closed.
    // Rendering that as "couldn't be loaded + Retry" was the recurring banner.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      ok: true, country: "us", live: false, reason: "environment", partial: false, fetchedAt: null, items: [],
    }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="us" initialCategory="verification" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(await screen.findByText(/Live availability is off in this environment/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByText(/couldn&apos;t be loaded/)).toBeNull();
    expect(screen.queryByText(/couldn't be loaded/)).toBeNull();
  });

  it("keeps the catalogue live when the live feed is temporarily unavailable", async () => {
    const unconfigured = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      ok: true, country: "us", live: false, reason: "unconfigured", partial: false, fetchedAt: null, items: [],
    }) });
    vi.stubGlobal("fetch", unconfigured);
    const first = render(<ServiceExplorer initialCountry="us" initialCategory="verification" />);
    expect(await screen.findByText(/isn't connected yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    first.unmount();

    // A transient outage should not cover the catalog with a blocking warning
    // while the fallback explorer listings still render.
    const broken = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: "nope", reason: "unavailable" }) });
    vi.stubGlobal("fetch", broken);
    render(<ServiceExplorer initialCountry="us" initialCategory="verification" />);
    expect(await screen.findByRole("heading", { name: /Explore App verification/i })).toBeTruthy();
    expect(screen.queryByText(/couldn&apos;t be loaded/)).toBeNull();
    expect(screen.queryByText(/couldn't be loaded/)).toBeNull();
    expect(await screen.findByRole("button", { name: "Retry" }, { timeout: 5000 })).toBeTruthy();
  });

  it("says we are restocking when the balance is the reason, and drops the retry", async () => {
    // Connected suppliers with an empty balance: there is nothing for the
    // customer to retry, and telling them to would be a promise we cannot keep.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      ok: true, country: "us", live: false, reason: "funding", partial: false, fetchedAt: null, items: [],
    }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="us" initialCategory="verification" />);
    expect((await screen.findAllByText(/Live listings are paused while we restock\./i)).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByText(/couldn't be loaded/)).toBeNull();
  });

  it("shows a funding gap as restocking even when some listings loaded", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      ok: true, country: "us", live: true, reason: "funding", partial: true, fetchedAt: "2026-01-01T00:00:00Z", items: [
        { id: "live-sms-test", category: "verification", name: "Example live app", description: "SMS verification listing", tag: "Other",
          artwork: { kind: "service", name: "numbers" }, source: "live", coverage: "catalog-country", stock: 3, myUnits: null, price: null, action: null },
      ],
    }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="us" initialCategory="verification" />);
    const note = await screen.findByRole("status");
    expect(note.textContent).toMatch(/paused while we restock/);
    // The row still renders, and no Retry is offered for a money gap.
    expect(await screen.findByRole("heading", { name: "Example live app" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("asks a signed-out shopper to sign in instead of repeatedly retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: "Please sign in" }, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="us" initialCategory="verification" />);
    expect((await screen.findByRole("link", { name: "Sign in again" })).getAttribute("href")).toBe("/login?next=%2Fdashboard%2Fservices");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("names a throttle as a throttle and still offers the retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: "slow down", reason: "throttled" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="us" initialCategory="verification" />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/refreshed too quickly/), { timeout: 5000 });
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    // The neutral note explains it too, rather than claiming nothing is shown yet.
    expect(screen.getAllByText(/refreshed too quickly/).length).toBeGreaterThan(1);
  });
});

it("does not blame a healthy social shelf for a failed verification feed", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const feed = new URL(url, "https://example.test").searchParams.get("feed");
    if (feed === "verification") return { ok: true, json: async () => ({ ok: true, country: "us", live: true, partial: true, items: [] }) };
    return { ok: true, json: async () => ({ ok: true, country: "us", live: true, items: [], fetchedAt: "2026-11-11T20:00:00Z" }) };
  }));
  render(<ServiceExplorer initialCountry="us" initialCategory="social" />);
  expect(await screen.findByText(/Live listings are current/)).toBeTruthy();
  expect(screen.queryByText(/Some live listings could not be loaded/)).toBeNull();
  const verification = screen.getAllByRole("button", { name: /App verification/i }).find(button => button.hasAttribute("aria-pressed"));
  fireEvent.click(verification!);
  expect(await screen.findByText(/Some live listings could not be loaded/)).toBeTruthy();
});
