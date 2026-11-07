// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ServiceExplorer } from "@/components/dashboard/ServiceExplorer";
import type { ExplorerItem } from "@/lib/services/service-explorer";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function boost(id: string, platform: string, name: string, tag = "Followers"): ExplorerItem {
  return {
    id: `live-boost-${id.padStart(20, "0")}`,
    category: "social",
    name,
    description: "Social promotion",
    tag,
    platform,
    detail: "Refill included · 100–10,000 units · ₦2,025 per 1,000",
    artwork: { kind: "service", name: "social-promotion" },
    source: "live",
    coverage: "not-country-specific",
    stock: null,
    myUnits: null,
    price: 1600,
    priceFrom: true,
    action: { label: "Buy boost", href: `/dashboard/services/boost/live-boost-${id.padStart(20, "0")}` },
  };
}

/** The shop receives every offer, already ordered by platform. */
function catalogue(): ExplorerItem[] {
  return [
    boost("1", "Instagram", "Instagram Followers | no refill"),
    boost("2", "Instagram", "Instagram Followers | 30 day refill"),
    boost("3", "Instagram", "Instagram Likes", "Likes"),
    boost("4", "TikTok", "TikTok Followers"),
    boost("5", "TikTok", "TikTok Views", "Views"),
    boost("6", "Kwai", "Kwai Followers"),
  ];
}

function serve(items: ExplorerItem[]) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, country: "ng", live: true, partial: false, fetchedAt: "2026-01-01T12:34:56.000Z", items }),
  }));
  render(<ServiceExplorer initialCountry="ng" initialCategory="social" />);
}

describe("social promotion grouped by platform", () => {
  it("groups every offer under its platform and counts the whole catalogue", async () => {
    serve(catalogue());
    const heading = await screen.findByRole("button", { name: /Instagram 3 listings/ });
    expect(heading.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /TikTok 2 listings/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Kwai 1 listing/ })).toBeTruthy();
    // The headline count is the full catalogue, not the collapsed handful.
    expect(screen.getByText(/6 listings · Nigeria selected/)).toBeTruthy();
  });

  it("opens the first platform and keeps the rest as headers", async () => {
    serve(catalogue());
    await screen.findByRole("heading", { name: "Instagram Followers | no refill" });
    // Every Instagram variant is a card, not just the cheapest.
    expect(screen.getByRole("heading", { name: "Instagram Followers | 30 day refill" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Instagram Likes" })).toBeTruthy();
    // Collapsed platforms render no cards until opened.
    expect(screen.queryByRole("heading", { name: "TikTok Followers" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Kwai Followers" })).toBeNull();
  });

  it("expands a platform when its header is clicked", async () => {
    serve(catalogue());
    const tiktok = await screen.findByRole("button", { name: /TikTok 2 listings/ });
    expect(tiktok.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(tiktok);
    expect(tiktok.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("heading", { name: "TikTok Followers" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "TikTok Views" })).toBeTruthy();

    fireEvent.click(tiktok);
    expect(tiktok.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("heading", { name: "TikTok Followers" })).toBeNull();
  });

  it("reveals matches in collapsed platforms when searching", async () => {
    serve(catalogue());
    await screen.findByRole("button", { name: /Kwai 1 listing/ });
    expect(screen.queryByRole("heading", { name: "Kwai Followers" })).toBeNull();
    // A search must not hide its own results behind a collapsed header.
    fireEvent.change(screen.getByRole("searchbox", { name: "Search services" }), { target: { value: "Kwai" } });
    expect(await screen.findByRole("heading", { name: "Kwai Followers" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Instagram Likes" })).toBeNull();
  });

  it("filters by intent across platforms and shows the variant detail", async () => {
    serve(catalogue());
    await screen.findByRole("button", { name: /Instagram 3 listings/ });
    fireEvent.click(screen.getByRole("button", { name: "Views" }));
    const card = (await screen.findByRole("heading", { name: "TikTok Views" })).closest("article")!;
    expect(within(card).getAllByText(/Refill included · 100–10,000 units/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Instagram Likes" })).toBeNull();
  });

  it("pages within a platform rather than dropping the rest", async () => {
    const many = Array.from({ length: 15 }, (_, index) => boost(String(index + 1), "Instagram", `Instagram Followers offer ${index + 1}`));
    serve(many);
    await screen.findByRole("heading", { name: "Instagram Followers offer 1" });
    expect(screen.queryByRole("heading", { name: "Instagram Followers offer 13" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /More Instagram \(3 remaining\)/ }));
    expect(screen.getByRole("heading", { name: "Instagram Followers offer 13" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Instagram Followers offer 15" })).toBeTruthy();
  });
});
