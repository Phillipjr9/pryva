import { NextRequest, NextResponse } from "next/server";
import {
  AccsZoneError,
  isAccsZoneConfigured,
  listAllCategories,
  listAllSubcategories,
} from "@/lib/accszone";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts/categories?categoryId=22
 *
 * Neutral URL on purpose: shoppers never see the supplier's name.
 * Categories are cached server-side for 30 minutes (provider cap: 30 req/min
 * for the whole account).
 */
export async function GET(request: NextRequest) {
  if (!isAccsZoneConfigured()) {
    // 200 with `configured: false` so the page can show a calm empty state
    // instead of an error when the key hasn't been added yet.
    return NextResponse.json({ configured: false, categories: [], subcategories: [] });
  }

  const categoryIdParam = request.nextUrl.searchParams.get("categoryId");
  const categoryId = categoryIdParam ? Number(categoryIdParam) : null;

  try {
    if (categoryId !== null) {
      if (!Number.isInteger(categoryId) || categoryId <= 0) {
        return NextResponse.json({ error: "Invalid category" }, { status: 400 });
      }
      const [categories, subcategories] = await Promise.all([
        listAllCategories(),
        listAllSubcategories(categoryId),
      ]);
      return NextResponse.json({ configured: true, categories, subcategories });
    }

    const categories = await listAllCategories();
    return NextResponse.json({ configured: true, categories, subcategories: [] });
  } catch (error) {
    if (error instanceof AccsZoneError) {
      logger.error("Marketplace categories failed", {
        code: error.code,
        status: error.status,
        requestId: error.requestId,
      });
      return NextResponse.json(
        { error: "Could not load categories. Please try again shortly.", code: error.code },
        { status: error.status === 429 ? 429 : 502 },
      );
    }
    logger.error("Marketplace categories crashed", { error });
    return NextResponse.json({ error: "Could not load categories" }, { status: 500 });
  }
}
