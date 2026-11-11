import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  preview: false,
  bulkaccConfigured: false,
  accszoneConfigured: false,
  products: [] as Record<string, unknown>[],
  catalogError: null as Error | null,
  catalogPartial: false,
  productError: null as Error | null,
  legacyListings: [] as Record<string, unknown>[],
  legacyPaged: false,
  legacyCategories: [] as { id: number; title: string; slug: string }[],
  legacyError: null as Error | null,
  order: null as { orderCode: string } | null,
  orderError: null as Error | null,
  delivered: [] as string[],
  balanceOk: true,
  calls: {
    listAllProducts: 0, getProduct: 0, createOrder: 0, getOrderAccounts: 0,
    getListing: 0, purchase: 0, balance: 0,
  },
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/platform/demo-policy", () => ({ isPreviewDatabase: () => runtime.preview }));
vi.mock("@/lib/platform/logger", () => ({ logger: runtime.log }));

vi.mock("@/lib/providers/bulkacc", () => {
  class BulkaccError extends Error {
    constructor(message: string, public code: string, public status: number) {
      super(message);
      this.name = "BulkaccError";
    }
  }
  return {
    BulkaccError,
    isBulkaccConfigured: () => runtime.bulkaccConfigured,
    isAmbiguousOutcome: (error: unknown) =>
      error instanceof BulkaccError && ["ambiguous_outcome", "timeout", "bad_response"].includes(error.code),
    readBulkaccCatalog: async () => {
      runtime.calls.listAllProducts += 1;
      if (runtime.catalogError) throw runtime.catalogError;
      return { products: runtime.products, partial: runtime.catalogPartial, checkedAt: new Date().toISOString() };
    },
    getProduct: async (code: string) => {
      runtime.calls.getProduct += 1;
      if (runtime.productError) throw runtime.productError;
      const found = runtime.products.find((product) => product.code === code);
      if (!found) throw new BulkaccError("Product is no longer available", "product_not_found", 404);
      return found;
    },
    productPriceUsd: (product: { priceUsd: string }) => product.priceUsd,
    ensureSufficientBalance: async () => {
      runtime.calls.balance += 1;
      return runtime.balanceOk;
    },
    createOrder: async () => {
      runtime.calls.createOrder += 1;
      if (runtime.orderError) throw runtime.orderError;
      if (!runtime.order) throw new BulkaccError("Marketplace outcome is unknown", "ambiguous_outcome", 502);
      return runtime.order;
    },
    getOrderAccounts: async () => {
      runtime.calls.getOrderAccounts += 1;
      return runtime.delivered;
    },
  };
});

vi.mock("@/lib/providers/accszone", () => {
  class AccsZoneError extends Error {
    constructor(message: string, public code: string, public status: number) {
      super(message);
      this.name = "AccsZoneError";
    }
  }
  return {
    AccsZoneError,
    isAccsZoneConfigured: () => runtime.accszoneConfigured,
    listListings: async (query: { page?: number } = {}) => {
      if (runtime.legacyError) throw runtime.legacyError;
      return {
        listings: runtime.legacyPaged ? runtime.legacyListings.slice((query.page ?? 1) - 1, query.page ?? 1) : runtime.legacyListings,
        meta: { current_page: query.page ?? 1, last_page: runtime.legacyPaged ? runtime.legacyListings.length : 1, per_page: runtime.legacyPaged ? 1 : 20, total: runtime.legacyListings.length },
      };
    },
    listAllCategories: async () => {
      if (runtime.legacyError) throw runtime.legacyError;
      return runtime.legacyCategories;
    },
    listAllSubcategories: async () => [],
    getListing: async (slug: string) => {
      runtime.calls.getListing += 1;
      const found = runtime.legacyListings.find((listing) => listing.slug === slug);
      if (!found) throw new AccsZoneError("Listing not found", "listing_not_found", 404);
      return found;
    },
    purchaseAccounts: async () => {
      runtime.calls.purchase += 1;
      return { order_id: 42, accounts: runtime.delivered };
    },
  };
});

import {
  getMarketplaceListing,
  groupLabelFor,
  isMarketplaceCatalogAvailable,
  labelId,
  listMarketplaceCategories,
  listMarketplaceListings,
  clearMarketplaceCatalogCache,
  marketplaceSource,
  MarketplaceError,
  parseListingSlug,
  purchaseMarketplaceListing,
  supportsPromoCodes,
} from "@/lib/services/accounts/marketplace-suppliers";
import { availableManualProducts, clearManualCatalogCache, getManualProduct, manualWarrantyDays } from "@/lib/services/accounts/manual-catalog";
import { readFileSync } from "node:fs";

/** Every string a customer could receive, from every source at once. */
const FORBIDDEN = [
  "bulkacc", "freshbulkacc", "accszone", "fleexa", "resellacc",
  "reseller", "wholesale", "supplier", "upstream", "vendor", "api key", "apikey",
];

const SPOTIFY = {
  code: "300004", name: "Aged United States (US) Spotify with Email Access", description: null,
  groupName: "Spotify", categoryName: "Aged USA Spotify", inStock: 32949, min: 1,
  priceMicros: 1_200_000, priceUsd: "1.200000",
};
const GMAIL = {
  code: "200345", name: "Warmed Up Gmail With 2FA", description: null,
  groupName: "Google", categoryName: "Gmail", inStock: 7969, min: 5,
  priceMicros: 800_000, priceUsd: "0.800000",
};
const SOLD_OUT = {
  code: "100001", name: "Aged Netflix Profile", description: null,
  groupName: "Streaming Media", categoryName: "Netflix", inStock: 0, min: 1,
  priceMicros: 2_500_000, priceUsd: "2.500000",
};

function secretLeak(value: unknown): string[] {
  const haystack = JSON.stringify(value).toLowerCase();
  return FORBIDDEN.filter((needle) => haystack.includes(needle));
}

beforeEach(() => {
  clearMarketplaceCatalogCache();
  runtime.preview = false;
  runtime.legacyPaged = false;
  runtime.bulkaccConfigured = true;
  runtime.accszoneConfigured = true;
  runtime.products = [SPOTIFY, GMAIL, SOLD_OUT];
  runtime.catalogError = null;
  runtime.catalogPartial = false;
  runtime.productError = null;
  runtime.legacyListings = [{
    id: 7, slug: "legacy-instagram", title: "Instagram account", price: "0.44",
    available_stock: 10, sold: 3, category: { id: 1, title: "Instagram", slug: "instagram" }, subcategory: null,
  }];
  runtime.legacyCategories = [{ id: 1, title: "Instagram", slug: "instagram" }];
  runtime.legacyError = null;
  runtime.order = { orderCode: "3120240416094425327" };
  runtime.orderError = null;
  runtime.delivered = ["user|password|recovery"];
  runtime.balanceOk = true;
  for (const key of Object.keys(runtime.calls) as Array<keyof typeof runtime.calls>) runtime.calls[key] = 0;
  clearManualCatalogCache();
});

afterEach(() => {
  vi.clearAllMocks();
  clearManualCatalogCache();
});

describe("product grouping is Pryva's own, not a source's", () => {
  it("labels streaming products as streaming whatever taxonomy they arrived in", () => {
    expect(groupLabelFor({ groupName: "Spotify" })).toBe("Streaming");
    // A source with no streaming group still gets streaming products recognised.
    expect(groupLabelFor({ groupName: "Other Social Networks", name: "Netflix Premium 4K" })).toBe("Streaming");
    expect(groupLabelFor({ groupName: "Game", name: "Roblox" })).toBe("Gaming");
    expect(groupLabelFor({ groupName: "Other", name: "Roblox account" })).toBe("Gaming");
    expect(groupLabelFor({ groupName: "Other", name: "Grok Premium" })).toBe("AI tools");
    expect(groupLabelFor({ groupName: "Other", name: "Tripadvisor reviews" })).toBe("Reviews");
    expect(groupLabelFor({ groupName: "Google" })).toBe("Email");
    expect(groupLabelFor({ groupName: "Something New" })).toBe("Other");
    expect(groupLabelFor({})).toBe("Other");
  });

  it("derives stable, opaque listing ids", () => {
    expect(labelId("Streaming")).toBe(labelId("Streaming"));
    expect(labelId("Streaming")).not.toBe(labelId("Social"));
    expect(labelId("Streaming")).toBeGreaterThan(0);

    expect(parseListingSlug("p1:300004")).toEqual({ token: "1", reference: "300004" });
    expect(parseListingSlug("p2:legacy-instagram")).toEqual({ token: "2", reference: "legacy-instagram" });
    expect(parseListingSlug("p3:netflix-standard")).toEqual({ token: "3", reference: "netflix-standard" });
    for (const junk of ["", "300004", "p9:300004", "p1:", "p1", `p1:${"x".repeat(77)}`, "P1:300004"]) {
      expect(parseListingSlug(junk)).toBeNull();
    }
    // The whole slug still has to fit orders.product_slug (varchar 80).
    expect(`p1:${"x".repeat(76)}`.length).toBeLessThanOrEqual(80);
  });

  it("only offers promo codes on the source that publishes a promo API", () => {
    expect(supportsPromoCodes("p2:legacy-instagram")).toBe(true);
    expect(supportsPromoCodes("p1:300004")).toBe(false);
    expect(supportsPromoCodes("p3:netflix-standard")).toBe(false);
    expect(supportsPromoCodes("nonsense")).toBe(false);
  });
});

describe("sourcing order", () => {
  it("reports the configured source and never publishes a cold partial fallback", async () => {
    expect(marketplaceSource()).toBe("primary");

    runtime.bulkaccConfigured = false;
    expect(marketplaceSource()).toBe("fallback");

    runtime.accszoneConfigured = false;
    expect(marketplaceSource()).toBe("none");
    expect(isMarketplaceCatalogAvailable()).toBe(false);
    expect((await listMarketplaceListings()).listings).toEqual([]);

    // A cold primary failure must not publish only the fallback and hide the
    // primary's products as though that were the whole catalogue.
    runtime.bulkaccConfigured = true;
    runtime.accszoneConfigured = true;
    runtime.catalogError = new Error("catalog read failed");
    clearMarketplaceCatalogCache();
    await expect(listMarketplaceListings()).rejects.toThrow("temporarily unavailable");
  });

  it("combines both feeds and applies shared social filters even when the primary succeeds", async () => {
    const result = await listMarketplaceListings({ perPage: 60 });
    expect(result.partial).toBe(false);
    expect(result.listings.some((listing) => listing.slug.startsWith("p1:"))).toBe(true);
    expect(result.listings.some((listing) => listing.slug === "p2:legacy-instagram")).toBe(true);
    const categories = await listMarketplaceCategories();
    const social = categories.categories.find((category) => category.title === "Social")!;
    expect(social).toBeDefined();
    const filtered = await listMarketplaceListings({ categoryId: social.id, search: "instagram" });
    expect(filtered.listings.map((listing) => listing.slug)).toContain("p2:legacy-instagram");
  });

  it("walks all secondary pages before shared filtering and pagination", async () => {
    runtime.legacyPaged = true;
    runtime.legacyListings.push({ ...runtime.legacyListings[0], id: 8, slug: "facebook-second-page", title: "Facebook aged account", category: { id: 2, title: "Facebook", slug: "facebook" } });
    const result = await listMarketplaceListings({ search: "facebook", perPage: 1 });
    expect(result.partial).toBe(false);
    expect(result.listings.map((listing) => listing.slug)).toEqual(["p2:facebook-second-page"]);
    expect(result.meta.total).toBe(1);
  });

  it("walks beyond the old 25-page cutoff before filtering the complete catalogue", async () => {
    runtime.legacyPaged = true;
    const sample = runtime.legacyListings[0];
    runtime.legacyListings = Array.from({ length: 26 }, (_, index) => ({ ...sample, id: index + 1, slug: `page-${index + 1}`, title: `Instagram page${index + 1}` }));
    const complete = await listMarketplaceListings({ search: "page26" });
    expect(complete.partial).toBe(false);
    expect(complete.listings.map((listing) => listing.slug)).toEqual(["p2:page-26"]);
  });

  it("sorts the entire combined catalogue by Naira selling price before slicing pages", async () => {
    const sellingPrice = vi.fn(async (listing: { slug: string }) => listing.slug === "p1:300004" ? 10 : listing.slug === "p2:legacy-instagram" ? 20 : 500);
    const first = await listMarketplaceListings({ perPage: 1, page: 1, sellingPrice });
    const second = await listMarketplaceListings({ perPage: 1, page: 2, sellingPrice });
    expect(first.listings[0].slug).toBe("p1:300004");
    expect(second.listings[0].slug).toBe("p2:legacy-instagram");
    expect(first.meta.total).toBe(second.meta.total);
    expect(first.meta.total).toBeGreaterThan(3);
  });

  it("keeps the last complete combined catalogue when a refresh fails", async () => {
    const initial = await listMarketplaceListings({ perPage: 60 });
    expect(initial.partial).toBe(false);
    runtime.legacyError = new Error("unavailable");
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 300_001);
    try {
      const result = await listMarketplaceListings({ perPage: 60 });
      expect(result.partial).toBe(false);
      expect(result.stale).toBe(true);
      expect(result.meta.total).toBe(initial.meta.total);
      expect(result.checkedAt).toBe(initial.checkedAt);
      expect(result.listings.some((listing) => listing.slug.startsWith("p1:"))).toBe(true);
    } finally { clock.mockRestore(); }
  });

  it("coalesces categories and listing requests into one shared read", async () => {
    await Promise.all([listMarketplaceListings(), listMarketplaceCategories(), listMarketplaceListings({ search: "instagram" })]);
    expect(runtime.calls.listAllProducts).toBe(1);
  });

  it("serves one catalog read for search, grouping, sorting and paging", async () => {
    const { listings, meta } = await listMarketplaceListings({ perPage: 2, page: 1 });
    expect(runtime.calls.listAllProducts).toBe(1);
    expect(listings).toHaveLength(2);
    expect(meta.total).toBeGreaterThan(2);

    // In-stock items outrank sold-out ones whatever the sort asks for.
    const all = await listMarketplaceListings({ perPage: 60, sort: "sort_key" });
    const last = all.listings[all.listings.length - 1];
    expect(last.stock).toBe(0);

    const streaming = await listMarketplaceListings({ categoryId: labelId("Streaming"), perPage: 60 });
    expect(streaming.listings.length).toBeGreaterThan(0);
    expect(streaming.listings.every((listing) => listing.group === "Streaming")).toBe(true);

    const searched = await listMarketplaceListings({ search: "gmail 2fa", perPage: 60 });
    expect(searched.listings.map((listing) => listing.title)).toContain("Warmed Up Gmail With 2FA");
  });

  it("includes recognized social products filed as Other without changing checkout terms", async () => {
    runtime.products.push({ code: "203412", name: "Australia (AU) Instagram with 2FA and Email Access", description: null,
      groupName: "Unrecognized", categoryName: "Aged Australia Instagram", inStock: 23, min: 1,
      priceMicros: 800_000, priceUsd: "0.800000" });
    runtime.products.push({ code: "203413", name: "Instagram access to Gmail", description: null,
      groupName: "Google", categoryName: "Gmail", inStock: 5, min: 1,
      priceMicros: 800_000, priceUsd: "0.800000" });
    const social = await listMarketplaceListings({ categoryId: labelId("Social"), perPage: 60 });
    const instagram = social.listings.find((listing) => listing.slug === "p1:203412");
    expect(instagram).toMatchObject({ group: "Other", browseGroup: "Social", warrantyDays: 30, priceUsd: "0.800000", stock: 23 });
    expect(social.listings.some((listing) => listing.slug === "p1:203413")).toBe(false);
    const checkout = await getMarketplaceListing("p1:203412");
    expect(checkout).toMatchObject({ group: "Other", warrantyDays: 30, priceUsd: "0.800000", stock: 23 });
    expect(checkout.browseGroup).toBeUndefined();
  });

  it("groups API-sourced items by purpose", async () => {
    const { categories } = await listMarketplaceCategories();
    const titles = categories.map((category) => category.title);
    expect(titles).toContain("Streaming");
    expect(titles).toContain("Email");
    expect(secretLeak(categories)).toEqual([]);
  });
});

describe("primary catalogue completeness", () => {
  it("refuses to publish an incomplete primary snapshot", async () => {
    runtime.catalogPartial = true;
    clearMarketplaceCatalogCache();
    await expect(listMarketplaceListings()).rejects.toThrow("temporarily unavailable");
  });
});

describe("what a customer is shown", () => {
  it("never names a source, a wholesale cost or an API key in any listing", async () => {
    const { listings } = await listMarketplaceListings({ perPage: 60 });
    expect(listings.length).toBeGreaterThan(0);
    expect(secretLeak(listings)).toEqual([]);

    // Wholesale cost and the source's own id are internal to this layer; the
    // listings route strips both, which is asserted against the real response in
    // marketplace-listings-response.test.ts.
    for (const listing of listings) {
      expect(typeof listing.priceUsd).toBe("string");
      expect(secretLeak(listing)).toEqual([]);
    }

    const one = await getMarketplaceListing("p1:300004");
    expect(secretLeak({ ...one, sourceId: undefined })).toEqual([]);
    expect(one.group).toBe("Streaming");
    expect(one.warrantyDays).toBe(120);
  });

  it("only shows API listings and preserves reported stock", async () => {
    const { listings } = await listMarketplaceListings({ perPage: 60 });
    expect(listings.every((listing) => listing.fulfilment === "instant" && !listing.slug.startsWith("p3:"))).toBe(true);
    // API-sourced listings keep the count the source actually reported.
    const spotify = listings.find((listing) => listing.slug === "p1:300004");
    expect(spotify?.stock).toBe(32949);
    expect(spotify?.minQuantity).toBe(1);
    expect(spotify?.maxQuantity).toBe(50);
    // A sold-out item is visible but not orderable.
    const soldOut = listings.find((listing) => listing.slug === "p1:100001");
    expect(soldOut?.stock).toBe(0);
    expect(soldOut?.available).toBe(false);
  });

  it("closes the hand-sourced lane in the demo, where money is fictional", async () => {
    expect(availableManualProducts().length).toBeGreaterThan(0);
    runtime.preview = true;
    clearManualCatalogCache();
    expect(availableManualProducts()).toEqual([]);
    expect(getManualProduct("p3:netflix-standard")).toBeNull();
    // An order already placed still keeps the warranty it was sold with.
    expect(manualWarrantyDays("p3:netflix-standard")).toBe(120);
    expect(manualWarrantyDays("p1:300004")).toBeNull();
  });

  it("keeps every warranty and cost claim inside the published band", () => {
    const catalog = JSON.parse(readFileSync("data/manual-catalog.json", "utf8")) as {
      products: Record<string, { costUsd: string; warrantyDays: number; available: boolean }>;
    };
    for (const [id, row] of Object.entries(catalog.products)) {
      expect(row.costUsd).toMatch(/^\d+\.\d{1,6}$/);
      expect(Number(row.costUsd)).toBeGreaterThan(0);
      expect(row.warrantyDays).toBeGreaterThan(0);
      expect(row.warrantyDays).toBeLessThanOrEqual(365);
      expect(typeof row.available).toBe("boolean");
      expect(id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
    // The private owner fields must not be part of the sellable shape.
    const product = getManualProduct("p3:netflix-standard");
    expect(product).not.toBeNull();
    expect(secretLeak(product)).toEqual([]);
  });
});

describe("buying", () => {
  it("reads a listing once and buys once, with no second catalog call", async () => {
    const listing = await getMarketplaceListing("p1:300004");
    expect(runtime.calls.getProduct).toBe(1);

    const purchase = await purchaseMarketplaceListing({
      listing, quantity: 2, clientReference: "ref-1",
    });
    expect(purchase.accounts).toEqual(["user|password|recovery"]);
    expect(purchase.supplierOrder).toBe("3120240416094425327");
    // One verify, one balance check, one order, one credential read. No re-read.
    expect(runtime.calls).toMatchObject({ getProduct: 1, balance: 1, createOrder: 1, getOrderAccounts: 1 });
  });

  it("enforces the source's minimum, the basket ceiling and real stock", async () => {
    const gmail = await getMarketplaceListing("p1:200345");
    expect(gmail.minQuantity).toBe(5);

    await expect(purchaseMarketplaceListing({ listing: gmail, quantity: 1, clientReference: "r" }))
      .rejects.toMatchObject({ code: "bad_quantity" });
    await expect(purchaseMarketplaceListing({ listing: gmail, quantity: 51, clientReference: "r" }))
      .rejects.toMatchObject({ code: "bad_quantity" });

    const soldOut = await getMarketplaceListing("p1:100001");
    await expect(purchaseMarketplaceListing({ listing: soldOut, quantity: 1, clientReference: "r" }))
      .rejects.toMatchObject({ code: "out_of_stock", status: 409 });
    expect(runtime.calls.createOrder).toBe(0);
  });

  it("refuses before spending when the prepaid balance cannot cover the order", async () => {
    runtime.balanceOk = false;
    const listing = await getMarketplaceListing("p1:300004");
    await expect(purchaseMarketplaceListing({ listing, quantity: 1, clientReference: "r" }))
      .rejects.toMatchObject({ code: "insufficient_supplier_balance" });
    expect(runtime.calls.createOrder).toBe(0);
  });

  it("flags an unknowable outcome so the order is held, never retried", async () => {
    runtime.order = null;
    const listing = await getMarketplaceListing("p1:300004");
    const error = await purchaseMarketplaceListing({ listing, quantity: 1, clientReference: "r" })
      .then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(MarketplaceError);
    expect(error).toMatchObject({ ambiguous: true });
    expect(runtime.calls.createOrder).toBe(1);
  });

  it("keeps the order code when credentials cannot be read yet", async () => {
    runtime.delivered = [];
    const listing = await getMarketplaceListing("p1:300004");
    // An empty receipt is not an error: the order exists and is still fillable.
    const purchase = await purchaseMarketplaceListing({ listing, quantity: 1, clientReference: "r" });
    expect(purchase.supplierOrder).toBe("3120240416094425327");
    expect(purchase.accounts).toEqual([]);
  });

  it("refuses to buy a hand-sourced item through the supplier path", async () => {
    await expect(getMarketplaceListing("p3:netflix-standard"))
      .rejects.toMatchObject({ code: "listing_not_found", status: 404 });
    expect(runtime.calls.createOrder).toBe(0);
    expect(runtime.calls.purchase).toBe(0);
  });

  it("routes a fallback listing to the fallback source only", async () => {
    runtime.bulkaccConfigured = false;
    const { listings } = await listMarketplaceListings();
    const legacy = listings.find((listing) => listing.slug === "p2:legacy-instagram");
    expect(legacy).toBeDefined();

    const purchase = await purchaseMarketplaceListing({ listing: legacy!, quantity: 1, clientReference: "ref-2" });
    expect(purchase.supplierOrder).toBe("42");
    expect(runtime.calls.purchase).toBe(1);
    expect(runtime.calls.createOrder).toBe(0);
  });

  it("rejects a listing id that does not resolve", async () => {
    await expect(getMarketplaceListing("p1:does-not-exist")).rejects.toMatchObject({
      code: "listing_not_found", status: 404,
    });
    await expect(getMarketplaceListing("whatever")).rejects.toMatchObject({ code: "listing_not_found" });
  });
});
