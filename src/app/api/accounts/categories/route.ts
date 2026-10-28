import { NextRequest, NextResponse } from "next/server";
import {
  isMarketplaceCatalogAvailable,
  listMarketplaceCategories,
  listMarketplaceSubcategories,
  MarketplaceError,
} from "@/lib/marketplace-suppliers";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts/categories?categoryId=22
 *
 * Neutral URL and neutral labels on purpose: shoppers see Pryva's own product
 * groups ("Streaming", "Email", "Social"), never a supplier's taxonomy, and
 * never a supplier's name. Categories are cached server-side for 30 minutes
 * because the sources rate-limit catalog reads per account.
 */
export async function GET(request: NextRequest) {
  if (!isMarketplaceCatalogAvailable()) {
    // 200 with `configured: false` so the page can show a calm empty state
    // instead of an error when no source has been connected yet.
    return NextResponse.json({ configured: false, categories: [], subcategories: [] });
  }

  const categoryIdParam = request.nextUrl.searchParams.get("categoryId");
  const categoryId = categoryIdParam ? Number(categoryIdParam) : null;

  try {
    if (categoryId !== null) {
      if (!Number.isInteger(categoryId) || categoryId <= 0) {
        return NextResponse.json({ error: "Invalid category" }, { status: 400 });
      }
      const [{ categories }, subcategories] = await Promise.all([
        listMarketplaceCategories(),
        listMarketplaceSubcategories(categoryId),
      ]);
      return NextResponse.json({ configured: true, categories, subcategories });
    }

    const { categories, subcategories } = await listMarketplaceCategories();
    return NextResponse.json({ configured: true, categories, subcategories });
  } catch (error) {
    if (error instanceof MarketplaceError) {
      logger.error("Marketplace categories failed", { code: error.code, status: error.status });
      return NextResponse.json(
        { error: "Could not load categories. Please try again shortly.", code: error.code },
        { status: error.status === 429 ? 429 : 502 },
      );
    }
    logger.error("Marketplace categories crashed", { error });
    return NextResponse.json({ error: "Could not load categories" }, { status: 500 });
  }
}
