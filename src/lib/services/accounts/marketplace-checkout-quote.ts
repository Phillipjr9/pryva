import "server-only";

import { createHash } from "node:crypto";
import { validatePromo } from "@/lib/providers/accszone";
import { getMarketplaceListing, MarketplaceError, supportsPromoCodes, type MarketplaceListing } from "@/lib/services/accounts/marketplace-suppliers";
import { applyPromoDiscount, priceMarketplaceListing, type PriceBreakdown } from "@/lib/services/accounts/marketplace-pricing";
import { usdCents } from "@/lib/payments/supplier-money";
import { MIN_ORDER_NGN } from "@/lib/services/pricing";
import { formatNaira } from "@/lib/services/catalog";

export const MAX_MARKETPLACE_QUANTITY = 50;
const MAX_AMOUNT = 2_147_483_647;

type FailureDetails = { minQuantity?: number; maxQuantity?: number; available?: number; minimumOrderNgn?: number; totalNgn?: number };

/** An expected refusal containing only customer-safe information. */
export class MarketplaceQuoteFailure extends Error {
  constructor(message: string, public readonly code: string, public readonly status: number, public readonly details: FailureDetails = {}) {
    super(message);
  }
}

export type MarketplaceCheckoutQuote = {
  listing: MarketplaceListing;
  price: PriceBreakdown;
  quantity: number;
  promoCode: string;
  savedNgn: number;
};

/** Re-read and price exactly the basket the purchase route will later check. */
export async function calculateMarketplaceCheckoutQuote(input: {
  slug: string;
  quantity: number;
  promoCode: string;
}): Promise<MarketplaceCheckoutQuote> {
  const { slug, quantity, promoCode } = input;
  const listing = await getMarketplaceListing(slug);
  if (listing.slug !== slug || typeof listing.title !== "string" || !listing.title.trim() || listing.title.length > 160 ||
      usdCents(listing.priceUsd) <= 0 || (listing.category?.length ?? 0) > 80 ||
      !Number.isSafeInteger(listing.minQuantity) || listing.minQuantity < 1 || listing.minQuantity > MAX_MARKETPLACE_QUANTITY ||
      !Number.isSafeInteger(listing.maxQuantity) || listing.maxQuantity < listing.minQuantity ||
      (listing.fulfilment !== "manual" && listing.fulfilment !== "instant") ||
      !Number.isSafeInteger(listing.warrantyDays) || listing.warrantyDays < 0 ||
      (listing.stock !== null && (!Number.isSafeInteger(listing.stock) || listing.stock < 0))) {
    throw new MarketplaceQuoteFailure("Could not verify this listing. Please try again later.", "invalid_listing", 502);
  }
  if (quantity < listing.minQuantity) {
    throw new MarketplaceQuoteFailure(`This item has a minimum order of ${listing.minQuantity}.`, "quantity_too_small", 400, { minQuantity: listing.minQuantity });
  }
  if (!listing.available) throw new MarketplaceQuoteFailure("This item is not available right now.", "unavailable", 409);
  if (quantity > listing.maxQuantity) {
    throw new MarketplaceQuoteFailure(`The most you can order at once is ${listing.maxQuantity}.`, "quantity_too_large", 400, { maxQuantity: listing.maxQuantity });
  }
  if (listing.stock !== null && listing.stock < quantity) {
    throw new MarketplaceQuoteFailure(`Only ${listing.stock} left in stock.`, "stock_short", 409, { available: listing.stock });
  }

  let price = await priceMarketplaceListing({
    unitPriceUsd: listing.priceUsd,
    quantity,
    categoryTitle: listing.category ?? undefined,
    subcategoryTitle: listing.subcategory ?? undefined,
  });
  const originalTotalNgn = price.totalNgn;
  if (!Number.isSafeInteger(originalTotalNgn) || originalTotalNgn <= 0 || originalTotalNgn > MAX_AMOUNT) {
    throw new MarketplaceQuoteFailure("Could not verify the order price.", "invalid_price", 502);
  }
  if (promoCode) {
    if (!supportsPromoCodes(slug)) {
      throw new MarketplaceQuoteFailure("Promo codes do not apply to this item.", "promo_unsupported", 409);
    }
    try {
      const promo = await validatePromo(promoCode, usdCents(listing.priceUsd) * quantity / 100);
      const discounted = applyPromoDiscount(price, promo.discount);
      if (discounted.totalNgn >= price.totalNgn) throw new Error("Promo unavailable");
      price = discounted;
    } catch {
      throw new MarketplaceQuoteFailure("That promo is no longer available. Review your total before ordering.", "promo_unavailable", 409);
    }
  }
  if (!Number.isSafeInteger(price.totalNgn) || price.totalNgn <= 0 || price.totalNgn > MAX_AMOUNT) {
    throw new MarketplaceQuoteFailure("Could not verify the order price.", "invalid_price", 502);
  }
  if (price.totalNgn < MIN_ORDER_NGN) {
    throw new MarketplaceQuoteFailure(`Minimum order is ${formatNaira(MIN_ORDER_NGN)}. Add a second unit or pick a bigger listing.`, "minimum_order", 400, { minimumOrderNgn: MIN_ORDER_NGN, totalNgn: price.totalNgn });
  }
  return { listing, price, quantity, promoCode, savedNgn: promoCode ? originalTotalNgn - price.totalNgn : 0 };
}

/** Only customer-facing information leaves the server; wholesale costs and rates do not. */
export function publicMarketplaceCheckoutQuote(quote: MarketplaceCheckoutQuote) {
  const { listing, price, quantity, promoCode, savedNgn } = quote;
  // Bind confirmation to the item, quantity, code, and visible delivery terms,
  // not merely the total. Stock can change without changing those terms.
  const terms = createHash("sha256").update(JSON.stringify([
    listing.slug, quantity, promoCode, listing.title, listing.fulfilment, listing.warrantyDays,
  ])).digest("hex").slice(0, 24);
  return {
    slug: listing.slug, quantity, promoCode, totalNgn: price.totalNgn, savedNgn, terms,
    title: listing.title, fulfilment: listing.fulfilment, warrantyDays: listing.warrantyDays, stock: listing.stock,
  };
}

export function marketplaceQuoteError(error: unknown): { status: number; body: { error: string; code: string } & FailureDetails } {
  if (error instanceof MarketplaceQuoteFailure) {
    return { status: error.status, body: { error: error.message, code: error.code, ...error.details } };
  }
  if (error instanceof MarketplaceError && error.code === "listing_not_found") {
    return { status: 404, body: { error: "This listing is no longer available.", code: "listing_not_found" } };
  }
  return { status: 502, body: { error: "Could not verify this listing. Please try again later.", code: "quote_unavailable" } };
}
