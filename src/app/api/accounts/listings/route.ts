import { NextRequest, NextResponse } from "next/server";
import { AccsZoneError, isAccsZoneConfigured, listListings, type ListingQuery } from "@/lib/accszone";
import { priceMarketplaceListing } from "@/lib/marketplace-pricing";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const ALLOWED_SORTS = new Set(["sort_key", "total_price", "available_stock", "title"]);

/**
 * GET /api/accounts/listings?categoryId=&subcategoryId=&search=&sort=&direction=&page=
 *
 * Prices are computed server-side. The client only ever receives Naira figures,
 * so a tampered request can't change what a basket costs.
 */
export async function GET(request: NextRequest) {
  if (!isAccsZoneConfigured()) {
    return NextResponse.json({ configured: false, listings: [], meta: null });
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
    const { listings, meta } = await listListings(query);

    const priced = await Promise.all(
      listings.map(async (listing) => {
        const breakdown = await priceMarketplaceListing({
          unitPriceUsd: listing.price,
          quantity: 1,
          categoryTitle: listing.category?.title,
          subcategoryTitle: listing.subcategory?.title,
        });

        return {
          id: listing.id,
          slug: listing.slug,
          title: listing.title,
          stock: listing.available_stock,
          sold: listing.sold,
          category: listing.category?.title ?? null,
          subcategory: listing.subcategory?.title ?? null,
          priceNgn: breakdown.unitNgn,
        };
      }),
    );

    return NextResponse.json({ configured: true, listings: priced, meta });
  } catch (error) {
    if (error instanceof AccsZoneError) {
      logger.error("Marketplace listings failed", {
        code: error.code,
        status: error.status,
        requestId: error.requestId,
      });
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
