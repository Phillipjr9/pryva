import { NextRequest, NextResponse } from "next/server";
import {
  labelId,
  listMarketplaceListings,
  MarketplaceError,
  type ListingQuery,
} from "@/lib/marketplace-suppliers";
import { isMarketplaceCatalogAvailable } from "@/lib/marketplace-suppliers";
import { isMarketplaceCheckoutConfigured } from "@/lib/marketplace-policy";
import { isManualFulfilmentReachable } from "@/lib/manual-fulfilment";
import { priceMarketplaceListing } from "@/lib/marketplace-pricing";
import { logger } from "@/lib/logger";
import { safeUnitCount } from "@/lib/service-units";

export const dynamic = "force-dynamic";

const ALLOWED_SORTS = new Set(["sort_key", "total_price", "available_stock", "title"]);

/**
 * GET /api/accounts/listings?categoryId=&subcategoryId=&search=&sort=&direction=&page=
 *
 * Prices are computed server-side and wholesale costs stay server-side: the
 * client only ever receives Naira figures, so a tampered request cannot change
 * what a basket costs. Nothing in the response identifies where stock comes
 * from — `slug` is an opaque routing token and `category` is Pryva's own group
 * label.
 */
export async function GET(request: NextRequest) {
  if (!isMarketplaceCatalogAvailable()) {
    return NextResponse.json({ configured: false, listings: [], meta: null }, { headers: { "Cache-Control": "no-store" } });
  }

  const params = request.nextUrl.searchParams;
  const toPositiveInt = (value: string | null): number | undefined => {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  };

  const sortParam = params.get("sort") ?? "sort_key";
  const query: ListingQuery = {
    categoryId: toPositiveInt(params.get("categoryId")),
    subcategoryId: toPositiveInt(params.get("subcategoryId")),
    search: params.get("search")?.trim().slice(0, 80) || undefined,
    sort: (ALLOWED_SORTS.has(sortParam) ? sortParam : "sort_key") as ListingQuery["sort"],
    direction: params.get("direction") === "desc" ? "desc" : "asc",
    page: toPositiveInt(params.get("page")) ?? 1,
  };

  try {
    const { listings, meta } = await listMarketplaceListings(query);

    const checkoutEnabled = isMarketplaceCheckoutConfigured();
    // Asked only when it can change an answer: with checkout off, or with no
    // hand-sourced listing on this page of results, the query would be wasted.
    const manualReady = checkoutEnabled && listings.some((listing) => listing.fulfilment === "manual")
      ? await isManualFulfilmentReachable()
      : false;

    const priced = await Promise.all(
      listings.map(async (listing) => {
        const breakdown = await priceMarketplaceListing({
          unitPriceUsd: listing.priceUsd,
          quantity: 1,
          // Premiums match on the source's own product-line text, which never
          // leaves the server; only the Pryva group label is returned.
          categoryTitle: listing.category ?? undefined,
          subcategoryTitle: listing.subcategory ?? undefined,
        });

        return {
          id: labelId(listing.slug),
          slug: listing.slug,
          title: listing.title,
          // A missing or malformed inventory figure is unknown, not zero.
          stock: safeUnitCount(listing.stock),
          sold: safeUnitCount(listing.sold),
          category: listing.group,
          subcategory: listing.category,
          priceNgn: breakdown.unitNgn,
          warrantyDays: listing.warrantyDays,
          minQuantity: listing.minQuantity,
          maxQuantity: listing.maxQuantity,
          available: listing.available,
          fulfilment: listing.fulfilment,
          /**
           * Whether checkout is permitted for THIS listing, decided server-side.
           *
           * Distinct from `available`, which is the source's own declaration of
           * stock, and from the page-wide pause: a hand-sourced item additionally
           * needs someone who can reach the queue that prepares it. Computing it
           * here rather than in the browser keeps one source of truth, and means
           * the purchase route and the storefront cannot disagree about what is
           * buyable.
           */
          purchasable: checkoutEnabled && (listing.fulfilment !== "manual" || manualReady),
        };
      }),
    );

    return NextResponse.json({ configured: true, listings: priced, meta }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof MarketplaceError) {
      logger.error("Marketplace listings failed", { code: error.code, status: error.status });
      const message =
        error.code === "rate_limit_exceeded"
          ? "The marketplace is busy. Please retry in a moment."
          : "Could not load listings. Please try again shortly.";
      return NextResponse.json({ error: message, code: error.code }, { status: error.status === 429 ? 429 : 502 });
    }
    logger.error("Marketplace listings crashed", { error });
    return NextResponse.json({ error: "Could not load listings" }, { status: 500 });
  }
}
