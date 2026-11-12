// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ServiceExplorer } from "@/components/dashboard/ServiceExplorer";
import { EXPLORER_CATEGORIES, explorerCategory, mergeExplorerSources, type ExplorerItem } from "@/lib/services/service-explorer";
import { SERVICE_IDS } from "@/lib/services/registry";

const offer = (id: string, name: string): ExplorerItem => ({
  id, name, category: "esim", description: "Travel data", tag: "eSIM", artwork: { kind: "service", name: "esim" },
  source: "catalog", coverage: "unconfirmed", stock: null, myUnits: null, price: null,
  action: { label: "Check offer", href: `/dashboard/digital-esims?product=${id}` },
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); });
it("recognizes every service family and keeps offers from different sources on the same shelf", () => {
  expect(EXPLORER_CATEGORIES.map((item) => item.id)).toEqual([...SERVICE_IDS]);
  for (const id of SERVICE_IDS) expect(explorerCategory(id)).toBe(id);
  expect(mergeExplorerSources([[offer("one", "Plan")], [offer("two", "Plan")]]).map((item) => item.id)).toEqual(["one", "two"]);
});
it("renders live, reviewed and digital catalogue eSIMs together, with their own checkout links", async () => {
  const digitalId = `digital-${"a".repeat(24)}`;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url.startsWith("/api/services/digital-catalog?") ? {
    ok: true, items: [{ id: digitalId, name: "Catalogue travel plan", stock: "reported", checkout: "esims" }], nextCursor: null,
  } : { ok: true, country: "ng", live: true, items: [offer("live", "Live travel plan")] } })));
  render(<ServiceExplorer initialCountry="ng" initialCategory="esim" enableDigitalCatalogue reviewedItems={[offer("reviewed", "Reviewed travel plan")]} />);
  for (const name of ["Live travel plan", "Reviewed travel plan", "Catalogue travel plan"]) {
    const card = (await screen.findByRole("heading", { name })).closest("article")!;
    expect(within(card).getByRole("link").getAttribute("href")).toContain("/dashboard/digital-esims?product=");
  }
});
it("finds a game's top-up even when it is filed under the supplier's general top-up shelf", async () => {
  const id = `digital-${"b".repeat(24)}`;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => {
    if (url.startsWith("/api/services/digital-catalog?")) {
      const params = new URL(url, "https://example.test").searchParams;
      return { ok: true, items: !params.has("category") ? [{ id, name: "Mobile Legends diamonds", stock: "reported", checkout: "topups" }] : [], nextCursor: null };
    }
    return { ok: true, categories: [], country: "ng", live: true, items: [] };
  } })));
  render(<ServiceExplorer initialCountry="ng" initialCategory="games" enableDigitalCatalogue />);
  const card = (await screen.findByRole("heading", { name: "Mobile Legends diamonds" })).closest("article")!;
  expect(within(card).getByRole("link").getAttribute("href")).toBe(`/dashboard/digital-topups?product=${id}`);
});
it("keeps all gift-card offers visible rather than hiding a more expensive supplier", () => {
  const gift = (id: string, price: number): ExplorerItem => ({ ...offer(id, "Same gift card"), category: "gift-cards", price,
    giftCardEquivalenceKey: "same-reviewed-terms" });
  render(<ServiceExplorer initialCountry="ng" initialCategory="gift-cards" reviewedItems={[gift("cheap", 1000), gift("other", 1200)]} />);
  expect(screen.getAllByRole("heading", { name: "Same gift card" })).toHaveLength(2);
});

it("explains the smaller number-plan shelf and opens app verification without changing country", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, country: "ng", live: true, items: [] }) })));
  render(<ServiceExplorer initialCountry="ng" initialCategory="numbers" />);
  expect(screen.getByText(/App-specific SMS numbers are grouped under App verification/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Browse app-specific verification numbers" }));
  expect(screen.getByRole("heading", { level: 1, name: "App verification" })).toBeTruthy();
  expect(new URLSearchParams(window.location.search).get("country")).toBe("ng");
});

it("loads the live data catalogue inside the data category without unrelated feeds", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const fetchMock = vi.fn(async (url: string) => { void url; return ({ ok: true, json: async () => ({
    plans: [{ id: "bundle-1", networkCode: "01", network: "MTN", name: "Live 1GB bundle", publishedAmountKobo: 50000 }],
    checkedAt: "2026-11-11T20:00:00Z", stale: false, checkoutReason: "Checkout is being connected.",
  }) }); });
  vi.stubGlobal("fetch", fetchMock);
  render(<ServiceExplorer initialCountry="us" initialCategory="data" enableDigitalCatalogue />);
  expect(await screen.findByRole("heading", { name: "Live 1GB bundle" })).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe("/api/airtime/plans");
  expect(timeout).toHaveBeenCalledWith(65_000);
  expect(screen.queryByText(/Some live listings could not be loaded/)).toBeNull();
  expect(screen.getByText(/Purchases are not available from this catalogue yet/)).toBeTruthy();
  timeout.mockRestore();
});
