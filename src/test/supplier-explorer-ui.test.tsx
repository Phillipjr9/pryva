// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ServiceExplorer } from "@/components/dashboard/ServiceExplorer";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("service explorer live listings", () => {
  it("waits for a country and labels stock, indicative price and paused ordering", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      ok: true, country: "us", partial: false, fetchedAt: "2026-01-01T12:34:56.000Z", items: [{
        id: "live-sms-test", category: "verification", name: "Example live app", description: "SMS verification listing", tag: "Other",
        artwork: { kind: "service", name: "numbers" }, source: "live", coverage: "catalog-country", stock: 7, myUnits: null, price: 1250, action: null,
      }],
    }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceExplorer initialCountry={null} initialCategory="verification" />);
    expect(fetchMock).not.toHaveBeenCalled();
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
});
