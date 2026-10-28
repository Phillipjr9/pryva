import { NextRequest, NextResponse } from "next/server";
import { AccsZoneError, isAccsZoneConfigured, validatePromo } from "@/lib/accszone";
import { getListing } from "@/lib/accszone";
import { applyPromoDiscount, priceMarketplaceListing } from "@/lib/marketplace-pricing";
import { requireAuthApi } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { isSameOriginMutation } from "@/lib/net";
import { isMarketplacePurchaseEnabled } from "@/lib/marketplace-policy";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { purchaseRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/accounts/promo
 * body: { code: string, slug: string, quantity: number }
 *
 * The client sends a listing slug + quantity rather than a price, so the
 * discount is always computed against the server's own basket total.
 * Invalid codes come back as HTTP 400 from upstream — turned into a friendly
 * 200 here so the UI can show inline text instead of an error state.
 */
export async function POST(request: NextRequest) {
  const user = await requireAuthApi();
  if (!user) {
    return NextResponse.json({ error: "Please sign in to use a promo code." }, { status: 401 });
  }
  if (!isSameOriginMutation(request)) return NextResponse.json({ valid: false, message: "Invalid origin." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ valid: false, message: "Expected JSON." }, { status: 415 });
  if (!isMarketplacePurchaseEnabled() || !isAccsZoneConfigured()) {
    return NextResponse.json({ valid: false, message: "Promo codes are unavailable right now." }, { status: 200 });
  }
  const limit = await purchaseRateLimiter(`accounts-promo:${user.id}`);
  if (limit.unavailable) return NextResponse.json({ valid: false, message: "Promo codes are temporarily unavailable." }, { status: 503 });
  if (!limit.allowed) return NextResponse.json({ valid: false, message: "Too many attempts. Try again later." }, { status: 429 });

  let body: { code?: unknown; slug?: unknown; quantity?: unknown };
  try {
    const value = await readJsonWithLimit(request, 4_096);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid body");
    body = value;
  } catch (error) {
    return NextResponse.json({ valid: false, message: "Invalid request." }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
  }

  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const quantity = typeof body.quantity === "number" ? body.quantity : Number(body.quantity);
  if (code.length > 40 || slug.length > 80 || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
    return NextResponse.json({ valid: false, message: "Invalid promo request." }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json({ valid: false, message: "Enter a promo code." }, { status: 200 });
  }
  if (!slug) {
    return NextResponse.json({ valid: false, message: "Choose an account first." }, { status: 400 });
  }

  try {
    const listing = await getListing(slug);
    const breakdown = await priceMarketplaceListing({
      unitPriceUsd: listing.price,
      quantity,
      categoryTitle: listing.category?.title,
      subcategoryTitle: listing.subcategory?.title,
    });

    // The provider validates against the USD basket amount.
    const basketUsd = ((Number(listing.price) * quantity) || 0).toFixed(2);
    const promo = await validatePromo(code, Number(basketUsd));
    const final = applyPromoDiscount(breakdown, promo.discount);

    if (final.totalNgn >= breakdown.totalNgn) {
      return NextResponse.json(
        { valid: false, message: "That code doesn't reduce this order." },
        { status: 200 },
      );
    }

    return NextResponse.json({
      valid: true,
      code,
      originalTotalNgn: breakdown.totalNgn,
      totalNgn: final.totalNgn,
      savedNgn: breakdown.totalNgn - final.totalNgn,
      message: `Code applied — you saved ₦${(breakdown.totalNgn - final.totalNgn).toLocaleString("en-NG")}.`,
    });
  } catch (error) {
    if (error instanceof AccsZoneError) {
      // `promo_invalid` is a normal outcome, not an incident.
      if (error.code === "promo_invalid" || error.status === 400) {
        return NextResponse.json({ valid: false, message: "That code isn't valid for this order." }, { status: 200 });
      }
      if (error.code === "listing_not_found") {
        return NextResponse.json({ valid: false, message: "That listing is no longer available." }, { status: 200 });
      }
      logger.error("Marketplace promo validation failed", {
        code: error.code,
        status: error.status,
        requestId: error.requestId,
      });
      return NextResponse.json(
        { valid: false, message: "We couldn't check that code. Please try again." },
        { status: 200 },
      );
    }

    logger.error("Marketplace promo validation crashed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ valid: false, message: "We couldn't check that code." }, { status: 200 });
  }
}
