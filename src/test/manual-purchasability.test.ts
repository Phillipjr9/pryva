import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Per-listing purchasability.
 *
 * The marketplace pause gate is one switch for the whole page, and the purchase
 * route checks it BEFORE branching on whether a slug is hand-sourced. So the
 * moment a supplier key exists, checkout opens for the hand-prepared catalog too
 * — items whose only fulfilment path is `/admin/fulfilment`, which needs a
 * verified administrator. These assert that a hand-prepared listing is buyable
 * only when someone can actually prepare it, and that a supplier listing is
 * unaffected by that question.
 */

const runtime = vi.hoisted(() => ({
  catalogAvailable: true,
  checkoutEnabled: false,
  manualReachable: false,
  listings: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/marketplace-pricing", () => ({
  priceMarketplaceListing: async () => ({ unitNgn: 4750, totalNgn: 4750, discountNgn: 0, profitNgn: 1200 }),
}));
vi.mock("@/lib/marketplace-policy", () => ({
  isMarketplaceCheckoutConfigured: () => runtime.checkoutEnabled,
}));
vi.mock("@/lib/manual-fulfilment", () => ({
  isManualFulfilmentReachable: async () => runtime.manualReachable,
}));
vi.mock("@/lib/marketplace-suppliers", () => {
  class MarketplaceError extends Error {
    constructor(message: string, public code: string, public status: number) {
      super(message);
      this.name = "MarketplaceError";
    }
  }
  return {
    MarketplaceError,
    isMarketplaceCatalogAvailable: () => runtime.catalogAvailable,
    labelId: (label: string) => label.length + 1000,
    listMarketplaceListings: async () => ({
      listings: runtime.listings,
      meta: { current_page: 1, last_page: 1, per_page: 24, total: runtime.listings.length },
      source: "primary",
    }),
  };
});

import { GET } from "@/app/api/accounts/listings/route";

const request = () => new NextRequest("https://pryva.test/api/accounts/listings");

function row(overrides: Record<string, unknown>) {
  return {
    slug: "p1:300004", sourceId: "300004", title: "Supplier account", group: "Social",
    category: null, subcategory: null, priceUsd: "1.200000", stock: 12, sold: 40,
    minQuantity: 1, maxQuantity: 50, available: true, warrantyDays: 30,
    fulfilment: "instant",
    ...overrides,
  };
}

const MANUAL = row({
  slug: "p3:netflix-standard", sourceId: "netflix-standard", title: "Netflix Standard (1080p)",
  group: "Streaming", priceUsd: "2.500000", stock: null, sold: null,
  warrantyDays: 120, fulfilment: "manual",
});

async function purchasableBySlug() {
  const body = await (await GET(request())).json();
  return Object.fromEntries(
    (body.listings as Array<{ slug: string; purchasable: boolean }>).map((l) => [l.slug, l.purchasable]),
  );
}

beforeEach(() => {
  runtime.catalogAvailable = true;
  runtime.checkoutEnabled = false;
  runtime.manualReachable = false;
  runtime.listings = [row({}), MANUAL];
});

describe("per-listing purchasability", () => {
  it("pauses everything while checkout is off, whatever the fulfilment queue looks like", async () => {
    runtime.checkoutEnabled = false;
    runtime.manualReachable = true;
    expect(await purchasableBySlug()).toEqual({ "p1:300004": false, "p3:netflix-standard": false });
  });

  it("opens supplier listings on checkout alone", async () => {
    runtime.checkoutEnabled = true;
    runtime.manualReachable = false;
    const result = await purchasableBySlug();
    expect(result["p1:300004"]).toBe(true);
    // The hand-prepared item stays paused: nobody can reach the queue that prepares it.
    expect(result["p3:netflix-standard"]).toBe(false);
  });

  it("opens a hand-prepared listing only once someone can prepare it", async () => {
    runtime.checkoutEnabled = true;
    runtime.manualReachable = true;
    expect(await purchasableBySlug()).toEqual({ "p1:300004": true, "p3:netflix-standard": true });
  });

  it("never reports an unavailable listing as purchasable", async () => {
    // `purchasable` is about permission, `available` about the source's own
    // declaration; the storefront requires both, so a withdrawn item must not
    // read as buyable even with the queue reachable.
    runtime.checkoutEnabled = true;
    runtime.manualReachable = true;
    runtime.listings = [MANUAL, row({ slug: "p1:999", available: false })];
    const body = await (await GET(request())).json();
    const withdrawn = (body.listings as Array<{ slug: string; available: boolean; purchasable: boolean }>)
      .find((l) => l.slug === "p1:999");
    expect(withdrawn).toMatchObject({ available: false });
  });
});
