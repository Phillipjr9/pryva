import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * End-to-end pricing through the real listings route.
 *
 * Every other route test mocks `@/lib/marketplace-pricing`, and the pricing unit
 * test only ever used two-decimal literals. Between those two habits a real
 * defect hid: the routing layer normalises every source price to a canonical
 * six-decimal string, but the pricing layer parsed it with the legacy
 * two-decimal parser, which threw on "3.480000". Configuring a source would have
 * 500'd the whole listing page.
 *
 * So this file mocks the *sources* and the exchange rate, and nothing between
 * them and the response. If a price shape ever stops being priceable again, the
 * route fails here instead of in production.
 */

const runtime = vi.hoisted(() => ({
  preview: false,
  bulkaccConfigured: true,
  accszoneConfigured: false,
  products: [] as Record<string, unknown>[],
  legacyListings: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/demo-policy", () => ({ isPreviewDatabase: () => runtime.preview }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/exchange-rate", () => ({
  getUsdToNgnRate: async () => ({ rate: 1600, source: "test", fetchedAt: new Date().toISOString() }),
}));

vi.mock("@/lib/bulkacc", () => ({
  isBulkaccConfigured: () => runtime.bulkaccConfigured,
  listAllProducts: async () => runtime.products,
  getProduct: async (code: string) => runtime.products.find((p) => p.code === code),
  productPriceUsd: (product: { priceUsd: string }) => product.priceUsd,
  normalizeProduct: (product: Record<string, unknown>) => product,
  ensureSufficientBalance: async () => true,
  createOrder: async () => ({ orderCode: "1" }),
  getOrderAccounts: async () => [],
  isAmbiguousOutcome: () => false,
  clearBulkaccCache: () => {},
}));

vi.mock("@/lib/accszone", () => {
  class AccsZoneError extends Error {
    constructor(message: string, public code: string, public status: number) {
      super(message);
      this.name = "AccsZoneError";
    }
  }
  return {
    AccsZoneError,
    isAccsZoneConfigured: () => runtime.accszoneConfigured,
    listListings: async () => ({
      listings: runtime.legacyListings,
      meta: { current_page: 1, last_page: 1, per_page: 20, total: runtime.legacyListings.length },
    }),
    listAllCategories: async () => [],
    listAllSubcategories: async () => [],
    getListing: async () => { throw new AccsZoneError("no", "listing_not_found", 404); },
    purchaseAccounts: async () => ({ order_id: 1, accounts: [] }),
    validatePromo: async () => ({ valid: false }),
  };
});

const { GET } = await import("@/app/api/accounts/listings/route");
const { clearManualCatalogCache } = await import("@/lib/manual-catalog");

const request = () => new NextRequest("https://pryva.test/api/accounts/listings", {
  headers: { host: "pryva.test" },
});

beforeEach(() => {
  runtime.preview = false;
  runtime.bulkaccConfigured = true;
  runtime.accszoneConfigured = false;
  runtime.legacyListings = [];
  // Realistic shapes: a documented five-decimal float price, a plain two-decimal
  // price, and a sub-cent price. `priceMicros` is what the real adapter produces
  // from the source's own number.
  runtime.products = [
    {
      code: "300004", name: "Aged United States (US) Spotify with Email Access", description: null,
      groupName: "Spotify", categoryName: "Aged USA Spotify", inStock: 32949, min: 1,
      priceMicros: 3_480_000, priceUsd: "3.480000",
    },
    {
      code: "300005", name: "Netflix Premium 4K UHD", description: null,
      groupName: "Other Social Networks", categoryName: "Streaming", inStock: 415, min: 1,
      priceMicros: 4_000_000, priceUsd: "4.000000",
    },
    {
      code: "300006", name: "Cheap aged profile", description: null,
      groupName: "Github", categoryName: "Aged", inStock: 10, min: 1,
      priceMicros: 69_920, priceUsd: "0.069920",
    },
  ];
  clearManualCatalogCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("listings route pricing, end to end", () => {
  it("prices six-decimal source prices instead of failing the whole page", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.configured).toBe(true);
    expect(body.listings.length).toBeGreaterThan(0);

    for (const listing of body.listings) {
      expect(Number.isFinite(listing.priceNgn), `${listing.title} priceNgn`).toBe(true);
      expect(listing.priceNgn, `${listing.title} priceNgn`).toBeGreaterThan(0);
      expect(Number.isInteger(listing.priceNgn), `${listing.title} priceNgn`).toBe(true);
    }

    // $3.48 at ₦1600 costs ₦5,568 and must sell above cost, inside the band.
    const spotify = body.listings.find((l: { title: string }) => l.title.includes("Spotify"));
    expect(spotify.priceNgn).toBeGreaterThanOrEqual(7238); // cost × 1.30 floor
    expect(spotify.priceNgn).toBeLessThanOrEqual(8352);    // cost × 1.50 ceiling
  });

  it("prices a sub-cent listing rather than dropping it", async () => {
    const body = await (await GET(request())).json();
    const cheap = body.listings.find((l: { title: string }) => l.title.includes("Cheap aged"));
    expect(cheap).toBeTruthy();
    expect(cheap.priceNgn).toBeGreaterThan(0);
  });

  it("never leaks the wholesale price or the source into the response", async () => {
    const body = await (await GET(request())).json();
    const json = JSON.stringify(body).toLowerCase();

    for (const word of [
      "bulkacc", "accszone", "fleexa", "freshbulkacc", "reseller", "wholesale",
      "supplier", "upstream", "vendor", "priceusd", "sourceid", "costusd", "apikey",
    ]) {
      expect(json, `response leaked "${word}"`).not.toContain(word);
    }
    // The exact public key set: nothing extra rides along.
    for (const listing of body.listings) {
      expect(Object.keys(listing).sort()).toEqual([
        "available", "category", "fulfilment", "id", "maxQuantity", "minQuantity",
        "priceNgn", "slug", "sold", "stock", "subcategory", "title", "warrantyDays",
      ]);
    }
  });

  it("still serves a catalog from the hand-prepared lane alone, with no API key", async () => {
    // No API source is connected, but the hand-prepared products need no key, so
    // the storefront is not empty — and those prices go through the same parser.
    runtime.bulkaccConfigured = false;
    runtime.accszoneConfigured = false;

    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.configured).toBe(true);
    expect(body.listings.length).toBeGreaterThan(0);
    expect(body.listings.every((l: { slug: string }) => l.slug.startsWith("p3:"))).toBe(true);
    for (const listing of body.listings) {
      expect(listing.priceNgn, listing.title).toBeGreaterThan(0);
    }
  });

  it("degrades to an empty catalog only when there is nothing at all to sell", async () => {
    // The hand-prepared lane is closed in the in-memory preview, so with no API
    // source either, the honest answer is "not configured" rather than a 500.
    runtime.preview = true;
    runtime.bulkaccConfigured = false;
    runtime.accszoneConfigured = false;
    clearManualCatalogCache();

    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ configured: false, listings: [], meta: null });
  });
});
