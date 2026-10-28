import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const runtime = vi.hoisted(() => ({
  configured: true,
  listings: [] as Record<string, unknown>[],
  error: null as Error | null,
  price: { unitNgn: 2500, totalNgn: 2500, discountNgn: 0, profitNgn: 800 },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/marketplace-pricing", () => ({
  priceMarketplaceListing: async () => runtime.price,
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
    isMarketplaceCatalogAvailable: () => runtime.configured,
    labelId: (label: string) => label.length + 1000,
    listMarketplaceListings: async () => {
      if (runtime.error) throw runtime.error;
      return {
        listings: runtime.listings,
        meta: { current_page: 1, last_page: 1, per_page: 24, total: runtime.listings.length },
        source: "primary",
      };
    },
  };
});

import { GET } from "@/app/api/accounts/listings/route";

/** Words that would tell a customer where their order actually comes from. */
const FORBIDDEN = [
  "bulkacc", "freshbulkacc", "accszone", "fleexa", "resellacc",
  "reseller", "wholesale", "supplier", "upstream", "vendor",
  "sourceid", "priceusd", "costusd", "cost", "apikey", "api key", "margin", "markup",
];

function request(search = ""): NextRequest {
  return new NextRequest(`https://pryva.test/api/accounts/listings${search}`, {
    headers: { host: "pryva.test" },
  });
}

const API_LISTING = {
  slug: "p1:300004",
  sourceId: "300004",
  title: "Aged United States (US) Spotify with Email Access",
  group: "Streaming",
  category: "Aged USA Spotify",
  subcategory: "Spotify",
  priceUsd: "1.200000",
  stock: 32949,
  minQuantity: 1,
  maxQuantity: 50,
  available: true,
  sold: null,
  warrantyDays: 120,
  fulfilment: "instant",
};
const MANUAL_LISTING = {
  slug: "p3:netflix-premium",
  sourceId: "netflix-premium",
  title: "Netflix Premium (4K UHD)",
  group: "Streaming",
  category: null,
  subcategory: null,
  priceUsd: "4.000000",
  stock: null,
  minQuantity: 1,
  maxQuantity: 5,
  available: true,
  sold: null,
  warrantyDays: 120,
  fulfilment: "manual",
};

beforeEach(() => {
  runtime.configured = true;
  runtime.listings = [API_LISTING, MANUAL_LISTING];
  runtime.error = null;
});
afterEach(() => vi.clearAllMocks());

describe("what the storefront actually receives", () => {
  it("returns Naira prices only, with no wholesale cost or source identity", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const body = (await response.json()) as { configured: boolean; listings: Record<string, unknown>[] };
    expect(body.configured).toBe(true);
    expect(body.listings).toHaveLength(2);

    const allowed = [
      "id", "slug", "title", "stock", "sold", "category", "subcategory",
      "priceNgn", "warrantyDays", "minQuantity", "maxQuantity", "available", "fulfilment",
    ];
    for (const listing of body.listings) {
      expect(Object.keys(listing).sort()).toEqual([...allowed].sort());
      expect(listing.priceNgn).toBe(2500);
    }

    // The whole response body, lowercased, must not mention sourcing at all.
    const haystack = JSON.stringify(body).toLowerCase();
    for (const word of FORBIDDEN) {
      expect(haystack, `response leaked "${word}"`).not.toContain(word);
    }
  });

  it("keeps an unknown stock count unknown instead of publishing a zero", async () => {
    const body = (await (await GET(request())).json()) as { listings: { stock: number | null; sold: number | null; available: boolean; fulfilment: string }[] };
    const manual = body.listings[1];
    expect(manual.stock).toBeNull();
    expect(manual.sold).toBeNull();
    expect(manual.available).toBe(true);
    expect(manual.fulfilment).toBe("manual");
  });

  it("serves Pryva's own group labels as the shopper-facing category", async () => {
    const body = (await (await GET(request())).json()) as { listings: { category: string | null; subcategory: string | null }[] };
    expect(body.listings[0].category).toBe("Streaming");
    // The source's own product-line text is used for pricing premiums only.
    expect(body.listings[0].subcategory).toBe("Aged USA Spotify");
  });

  it("answers calmly when nothing is connected, and neutrally when a source fails", async () => {
    runtime.configured = false;
    const empty = await (await GET(request())).json();
    expect(empty).toEqual({ configured: false, listings: [], meta: null });

    runtime.configured = true;
    const { MarketplaceError } = await import("@/lib/marketplace-suppliers");
    runtime.error = new MarketplaceError("busy", "rate_limit_exceeded", 429);
    const busy = await GET(request());
    expect(busy.status).toBe(429);
    const busyBody = (await busy.json()) as { error: string };
    expect(busyBody.error).toBe("The marketplace is busy. Please retry in a moment.");
    expect(JSON.stringify(busyBody).toLowerCase()).not.toContain("bulkacc");

    runtime.error = new MarketplaceError("down", "network_error", 502);
    const down = await GET(request());
    expect(down.status).toBe(502);
    expect(((await down.json()) as { error: string }).error).toBe("Could not load listings. Please try again shortly.");
  });
});
