// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ServiceExplorer } from "@/components/dashboard/ServiceExplorer";

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); });

describe("service explorer live listings", () => {
  it("uses the saved default country and labels stock, indicative price and paused ordering", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      ok: true, country: "us", partial: false, fetchedAt: "2026-01-01T12:34:56.000Z", items: [{
        id: "live-sms-test", category: "verification", name: "Example live app", description: "SMS verification listing", tag: "Other",
        artwork: { kind: "service", name: "numbers" }, source: "live", coverage: "catalog-country", stock: 7, myUnits: null, price: 1250, action: null,
      }],
    }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry={null} initialCategory="verification" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/services/catalog?country=ng");
    fireEvent.click(screen.getByRole("button", { name: "US" }));
    const card = (await screen.findByRole("heading", { name: "Example live app" })).closest("article")!;
    expect(within(card).getByText("Live listing")).toBeTruthy();
    expect(within(card).getByText("Reported region: United States")).toBeTruthy();
    expect(within(card).getByText("Indicative price ₦1,250")).toBeTruthy();
    expect(within(card).getByText("7 left")).toBeTruthy();
    expect(within(card).getByText("Not tracked")).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Ordering paused" }).hasAttribute("disabled")).toBe(true);
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
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
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
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
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
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
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

  it("names a throttle as a throttle and still offers the retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: "slow down", reason: "throttled" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry="us" initialCategory="verification" />);
    const note = await screen.findByRole("status");
    expect(note.textContent).toMatch(/refreshed too quickly/);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    // The neutral note explains it too, rather than claiming nothing is shown yet.
    expect(screen.getAllByText(/refreshed too quickly/).length).toBeGreaterThan(1);
  });
});
