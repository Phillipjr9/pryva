import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/identity/auth";
import { financialActionsUnavailable } from "@/lib/platform/financial-environment";
import { isManualFulfilmentReachable } from "@/lib/services/accounts/manual-fulfilment";
import { isManualSlug } from "@/lib/services/accounts/manual-catalog";
import { isMarketplaceCheckoutConfigured } from "@/lib/services/accounts/marketplace-policy";
import { calculateMarketplaceCheckoutQuote, marketplaceQuoteError, MAX_MARKETPLACE_QUANTITY, publicMarketplaceCheckoutQuote } from "@/lib/services/accounts/marketplace-checkout-quote";
import { isSameOriginMutation } from "@/lib/platform/net";
import { purchaseRateLimiter } from "@/lib/platform/rate-limit";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/platform/request-body";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const noStore = { "Cache-Control": "no-store" };

/** Read-only price review. No wallet debit, order, or paid supplier call. */
export async function POST(request: NextRequest) {
  const user = await requireAuthApi();
  if (!user) return NextResponse.json({ error: "Please sign in to review this price." }, { status: 401, headers: noStore });
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403, headers: noStore });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON." }, { status: 415, headers: noStore });
  if (financialActionsUnavailable() || !isMarketplaceCheckoutConfigured()) {
    return NextResponse.json({ error: "Account purchases are temporarily unavailable." }, { status: 503, headers: noStore });
  }

  const perUser = await purchaseRateLimiter(`accounts-quote:${user.id}`);
  if (perUser.unavailable) return NextResponse.json({ error: "Price reviews are temporarily unavailable." }, { status: 503, headers: noStore });
  if (!perUser.allowed) return NextResponse.json({ error: "Too many price checks. Please try again shortly." }, { status: 429, headers: noStore });

  let body: { slug?: unknown; quantity?: unknown; promoCode?: unknown };
  try {
    const value = await readJsonWithLimit(request, 4_096);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid body");
    body = value;
  } catch (error) {
    return NextResponse.json({ error: "Invalid request body." }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400, headers: noStore });
  }
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const quantity = typeof body.quantity === "number" ? body.quantity : Number(body.quantity);
  if (!slug || slug.length > 80 || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_MARKETPLACE_QUANTITY ||
      (body.promoCode != null && (typeof body.promoCode !== "string" || body.promoCode.trim().length > 40))) {
    return NextResponse.json({ error: "Invalid listing, quantity or promo code." }, { status: 400, headers: noStore });
  }
  const promoCode = typeof body.promoCode === "string" ? body.promoCode.trim().toUpperCase() : "";
  if (isManualSlug(slug)) {
    if (!(await isManualFulfilmentReachable())) {
      return NextResponse.json({ error: "This item cannot be prepared right now." }, { status: 503, headers: noStore });
    }
  } else {
    // Extra product reads share the marketplace provider's budget with paid
    // order calls. Cap reviews to reduce added load; other reads may still
    // exhaust the shared budget, so this does not reserve purchase capacity.
    const global = await purchaseRateLimiter("accounts-quote:provider-budget");
    if (global.unavailable) return NextResponse.json({ error: "Price reviews are temporarily unavailable." }, { status: 503, headers: noStore });
    if (!global.allowed) return NextResponse.json({ error: "Price reviews are busy. Please try again shortly." }, { status: 429, headers: noStore });
  }

  try {
    const quote = await calculateMarketplaceCheckoutQuote({ slug, quantity, promoCode });
    return NextResponse.json({ ok: true, quote: publicMarketplaceCheckoutQuote(quote) }, { headers: noStore });
  } catch (error) {
    const failure = marketplaceQuoteError(error);
    return NextResponse.json(failure.body, { status: failure.status, headers: noStore });
  }
}
