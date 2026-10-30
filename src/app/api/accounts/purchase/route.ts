import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, users, walletTransactions } from "@/db/schema";
import { requireAuthApi } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/net";
import {
  getMarketplaceListing,
  MarketplaceError,
  purchaseMarketplaceListing,
  supportsPromoCodes,
} from "@/lib/marketplace-suppliers";
import { isMarketplaceCheckoutConfigured } from "@/lib/marketplace-policy";
import { isManualFulfilmentReachable } from "@/lib/manual-fulfilment";
import { isManualSlug } from "@/lib/manual-catalog";
import { purchaseRateLimiter } from "@/lib/rate-limit";
import { validatePromo } from "@/lib/accszone";
import { usdCents } from "@/lib/supplier-money";
import { fulfilmentLabel } from "@/lib/warranty";
import { applyPromoDiscount, priceMarketplaceListing } from "@/lib/marketplace-pricing";
import { MIN_ORDER_NGN } from "@/lib/pricing";
import { logger } from "@/lib/logger";
import { scheduleWalletEmails } from "@/lib/schedule-wallet-emails";
import { formatNaira } from "@/lib/catalog";
import { readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_QUANTITY = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Order = typeof orders.$inferSelect;

class InsufficientBalance extends Error {}
class PendingPurchase extends Error {
  constructor(public readonly reference: string) { super("Previous purchase needs review"); }
}

// Scope the client-generated idempotency key to the authenticated user, so two
// users cannot deliberately reuse one supplier client_reference. This UUID is
// stable across retries of the same client request.
function scopedReference(userId: string, requestId: string): string {
  const hex = createHash("sha256").update(`${userId}\0${requestId.toLowerCase()}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function pendingResponse(reference: string, id?: string) {
  return NextResponse.json({
    pending: true,
    order: { ...(id ? { id } : {}), reference },
    message: "This purchase needs review. Your wallet may have been charged; do not place it again. Check your orders or contact support with this reference.",
  }, { status: 202 });
}

function existingResponse(order: Order, slug: string, quantity: number) {
  if (order.productSlug !== slug || order.planLabel !== `${quantity} × account`) {
    return NextResponse.json({ error: "This request ID belongs to a different purchase." }, { status: 409 });
  }
  if (order.status === "refunded") {
    return NextResponse.json({ error: "This order was refunded. Start a new purchase to try again.", order: { id: order.id, reference: order.reference } }, { status: 409 });
  }
  // A hand-sourced order in `processing` is not ambiguous — no supplier call was
  // made, so there is nothing to reconcile. Say it is being prepared instead of
  // warning that the wallet "may have been charged".
  if (order.provider === "manual" && order.status === "processing") {
    return NextResponse.json({
      ok: true,
      preparing: true,
      order: { id: order.id, reference: order.reference },
      quantity,
      totalNgn: order.amount,
      message: "Your order is confirmed and being prepared. Your credentials appear on the order page as soon as they are ready.",
    });
  }
  if (order.status === "delivered" && order.accounts) {
    try {
      const accounts: unknown = JSON.parse(order.accounts);
      if (Array.isArray(accounts) && accounts.length === quantity && accounts.every((item) => typeof item === "string" && item.trim())) {
        return NextResponse.json({ ok: true, order: { id: order.id, reference: order.reference }, listing: order.productName, quantity, accounts, totalNgn: order.amount });
      }
    } catch { /* An unreadable receipt requires review, not another purchase. */ }
  }
  return pendingResponse(order.reference, order.id);
}

async function markForReview(orderId: string, reference: string) {
  try {
    await db.update(orders).set({ status: "review" })
      .where(and(eq(orders.id, orderId), eq(orders.status, "processing"), isNull(orders.refundedAt)));
  } catch {
    // Leaving the order in processing also blocks automatic/admin refunds.
    logger.error("Marketplace order could not be marked for review", { reference });
  }
}

/**
 * Atomically reserve the wallet debit, order and ledger entry before sending a
 * single upstream purchase. The provider contract has not been verified, so
 * every uncertain or rejected outcome is held for manual reconciliation rather
 * than retried or automatically refunded. Live checkout is disabled by default.
 */
export async function POST(request: NextRequest) {
  const user = await requireAuthApi();
  if (!user) return NextResponse.json({ error: "Please sign in to buy accounts." }, { status: 401 });
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return NextResponse.json({ error: "Content-Type must be application/json." }, { status: 415 });
  }
  if (!isMarketplaceCheckoutConfigured()) {
    return NextResponse.json({ error: "Account purchases are temporarily unavailable." }, { status: 503 });
  }

  const limit = await purchaseRateLimiter(`accounts-purchase:${user.id}`);
  if (limit.unavailable) return NextResponse.json({ error: "Purchases are temporarily unavailable." }, { status: 503 });
  if (!limit.allowed) {
    const seconds = Math.max(1, Math.ceil((limit.resetTime - Date.now()) / 1000));
    return NextResponse.json({ error: `Too many attempts. Try again in ${seconds}s.` }, { status: 429 });
  }

  let body: { slug?: unknown; quantity?: unknown; promoCode?: unknown; requestId?: unknown };
  try {
    const value = await readJsonWithLimit(request, 4_096);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid body");
    body = value;
  } catch (error) {
    return NextResponse.json({ error: "Invalid request body" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
  }
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const quantity = typeof body.quantity === "number" ? body.quantity : Number(body.quantity);
  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  if (!slug || slug.length > 80 || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY || !UUID.test(requestId)) {
    return NextResponse.json({ error: "Invalid listing, quantity or request ID." }, { status: 400 });
  }
  if (body.promoCode != null && (typeof body.promoCode !== "string" || body.promoCode.trim().length > 40)) {
    return NextResponse.json({ error: "Invalid promo code." }, { status: 400 });
  }
  const promoCode = typeof body.promoCode === "string" ? body.promoCode.trim().toUpperCase() : "";
  const clientReference = scopedReference(user.id, requestId);
  const reference = `MKT-${clientReference.replace(/-/g, "").slice(0, 28)}`;
  // Hand-sourced items are recorded and queued; no supplier call is made.
  const isManual = isManualSlug(slug);

  // A hand-sourced item is prepared through /admin/fulfilment, which needs an
  // administrator with a verified address. Refuse here, before the wallet is
  // touched: the debit happens in a transaction further down, and taking money
  // for an item nobody can prepare is not made right by refunding it — the
  // customer still did not get what they bought. The storefront already hides
  // the button, but a hidden button is not a control.
  if (isManual && !(await isManualFulfilmentReachable())) {
    return NextResponse.json(
      { error: "This item cannot be prepared right now. No payment was taken." },
      { status: 503 },
    );
  }

  // A repeat of the same request must not call the supplier a second time, even
  // when the listing or provider is no longer available.
  try {
    const [previous] = await db.select().from(orders)
      .where(and(eq(orders.userId, user.id), eq(orders.reference, reference))).limit(1);
    if (previous) return existingResponse(previous, slug, quantity);
  } catch {
    return pendingResponse(reference);
  }

  let listing;
  let price;
  let appliedPromo: string | undefined;
  try {
    listing = await getMarketplaceListing(slug);
    if (!listing.title.trim() || listing.title.length > 160 ||
        usdCents(listing.priceUsd) <= 0 ||
        (listing.category?.length ?? 0) > 80 ||
        !Number.isSafeInteger(listing.minQuantity) || listing.minQuantity < 1 || listing.minQuantity > MAX_QUANTITY) {
      throw new Error("Invalid supplier listing");
    }
    if (quantity < listing.minQuantity) {
      return NextResponse.json({
        error: `This item has a minimum order of ${listing.minQuantity}.`,
        minQuantity: listing.minQuantity,
      }, { status: 400 });
    }
    if (!listing.available) {
      return NextResponse.json({ error: "This item is not available right now." }, { status: 409 });
    }
    if (quantity > listing.maxQuantity) {
      return NextResponse.json({
        error: `The most you can order at once is ${listing.maxQuantity}.`,
        maxQuantity: listing.maxQuantity,
      }, { status: 400 });
    }
    // `stock === null` is unknown, not zero: the source is still the authority.
    if (listing.stock !== null && listing.stock < quantity) {
      return NextResponse.json({ error: `Only ${listing.stock} left in stock.`, available: listing.stock }, { status: 409 });
    }
    price = await priceMarketplaceListing({
      unitPriceUsd: listing.priceUsd,
      quantity,
      categoryTitle: listing.category ?? undefined,
      subcategoryTitle: listing.subcategory ?? undefined,
    });
    if (promoCode) {
      // Only one source publishes a promo API. Refuse the code rather than
      // silently charging the undiscounted price a customer was shown.
      if (!supportsPromoCodes(slug)) {
        return NextResponse.json({ error: "Promo codes do not apply to this item." }, { status: 409 });
      }
      // Do not silently charge the non-discounted price if validation changed.
      try {
        const promo = await validatePromo(promoCode, usdCents(listing.priceUsd) * quantity / 100);
        const discounted = applyPromoDiscount(price, promo.discount);
        if (discounted.totalNgn >= price.totalNgn) throw new Error("Promo unavailable");
        price = discounted;
        appliedPromo = promoCode;
      } catch {
        return NextResponse.json({ error: "That promo is no longer available. Review your total before ordering." }, { status: 409 });
      }
    }
  } catch (error) {
    const status = error instanceof MarketplaceError && error.code === "listing_not_found" ? 404 : 502;
    return NextResponse.json({ error: "Could not verify this listing. Please try again later." }, { status });
  }
  if (!Number.isSafeInteger(price.totalNgn) || price.totalNgn > 2_147_483_647 || price.totalNgn <= 0) {
    return NextResponse.json({ error: "Could not verify the order price." }, { status: 502 });
  }
  if (price.totalNgn < MIN_ORDER_NGN) {
    return NextResponse.json({ error: `Minimum order is ${formatNaira(MIN_ORDER_NGN)}. Add a second unit or pick a bigger listing.`, minimumOrderNgn: MIN_ORDER_NGN, totalNgn: price.totalNgn }, { status: 400 });
  }

  let orderId: string;
  try {
    const reservation = await db.transaction(async (tx) => {
      // Serializes competing checkout intents for a user across app instances.
      // It prevents a second order while an earlier one needs reconciliation.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${user.id}))`);
      const [previous] = await tx.select().from(orders)
        .where(and(eq(orders.userId, user.id), eq(orders.reference, reference))).limit(1);
      if (previous) return { previous };
      const [unresolved] = await tx.select().from(orders).where(and(
        eq(orders.userId, user.id), eq(orders.provider, "accounts"),
        or(eq(orders.status, "processing"), eq(orders.status, "review")),
        isNull(orders.refundedAt),
      )).limit(1);
      if (unresolved) throw new PendingPurchase(unresolved.reference);
      const [updated] = await tx.update(users)
        .set({ walletBalance: sql`${users.walletBalance} - ${price.totalNgn}` })
        .where(and(eq(users.id, user.id), gte(users.walletBalance, price.totalNgn)))
        .returning({ balance: users.walletBalance });
      if (!updated) throw new InsufficientBalance();
      const [created] = await tx.insert(orders).values({
        reference, userId: user.id, service: "accounts", productSlug: listing.slug,
        productName: listing.title, planLabel: `${quantity} × account`,
        region: listing.group ?? "Global", duration: fulfilmentLabel(listing.fulfilment),
        amount: price.totalNgn, status: "processing",
        // A hand-sourced order makes no supplier call, so it carries its own
        // provider value: the unresolved-purchase guard above exists to stop a
        // second automated supplier request and must not block these.
        provider: isManual ? "manual" : "accounts",
        providerRequestId: isManual ? null : clientReference,
      }).returning({ id: orders.id });
      if (!created) throw new Error("Order insert failed");
      await tx.insert(walletTransactions).values({
        userId: user.id, orderId: created.id, type: "debit", amount: price.totalNgn,
        balanceAfter: updated.balance, reference,
        description: `Accounts purchase — ${listing.title}${appliedPromo ? ` (promo ${appliedPromo})` : ""}`.slice(0, 200),
      });
      return { orderId: created.id };
    });
    if (reservation.previous) return existingResponse(reservation.previous, slug, quantity);
    orderId = reservation.orderId!;
    scheduleWalletEmails();
    if (isManual) {
      // No supplier call to make. The order waits in the fulfilment queue and
      // its credentials appear on the order page once they are confirmed.
      logger.info("Hand-sourced order recorded", { reference, quantity });
      return NextResponse.json({
        ok: true,
        preparing: true,
        order: { id: orderId, reference },
        listing: listing.title,
        quantity,
        totalNgn: price.totalNgn,
        warrantyDays: listing.warrantyDays,
        message: "Your order is confirmed and being prepared. Your credentials appear on the order page as soon as they are ready.",
      });
    }
  } catch (error) {
    if (error instanceof InsufficientBalance) {
      return NextResponse.json({ error: "Insufficient wallet balance.", required: price.totalNgn }, { status: 402 });
    }
    if (error instanceof PendingPurchase) return pendingResponse(error.reference);
    // A lost database COMMIT response is ambiguous too. Never assert that no
    // charge occurred; the stable reference lets support find the reservation.
    logger.error("Marketplace reservation needs reconciliation", { reference });
    return pendingResponse(reference);
  }

  let purchase;
  try {
    purchase = await purchaseMarketplaceListing({ listing, quantity, clientReference, promoCode: appliedPromo });
  } catch (error) {
    // An ambiguous outcome means the supplier may already have taken our money.
    // Hold the order for review: never retry, never auto-refund.
    logger.warn("Marketplace purchase requires reconciliation", {
      reference,
      code: error instanceof MarketplaceError ? error.code : "unknown_error",
      ambiguous: error instanceof MarketplaceError ? error.ambiguous : false,
    });
    await markForReview(orderId, reference);
    return pendingResponse(reference, orderId);
  }

  // Preserve partial credentials for support/customer review, but call delivery
  // complete only when the upstream receipt contains the requested quantity.
  const accounts = Array.isArray(purchase?.accounts)
    ? purchase.accounts.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
  const supplierOrder = typeof purchase?.supplierOrder === "string" && purchase.supplierOrder.trim()
    ? purchase.supplierOrder.trim().slice(0, 160)
    : null;
  const complete = accounts.length === quantity && supplierOrder !== null;
  try {
    const [saved] = await db.update(orders).set({
      status: complete ? "delivered" : "review", referenceCode: supplierOrder,
      accounts: accounts.length ? JSON.stringify(accounts) : null,
    }).where(and(eq(orders.id, orderId), eq(orders.status, "processing"), isNull(orders.refundedAt)))
      .returning({ id: orders.id });
    if (!saved) return pendingResponse(reference, orderId);
  } catch {
    // Never log credentials; return them to the authenticated purchaser if the
    // receipt was complete, and leave a durable processing/review trail.
    logger.error("Marketplace delivery could not be saved", { reference });
    await markForReview(orderId, reference);
    if (complete) return NextResponse.json({
      ok: true, order: { id: orderId, reference }, listing: listing.title, quantity,
      accounts, totalNgn: price.totalNgn,
      warning: "We could not save these credentials. Copy them now and contact support with your reference.",
    });
    return pendingResponse(reference, orderId);
  }
  if (!complete) return pendingResponse(reference, orderId);
  scheduleWalletEmails();
  return NextResponse.json({
    ok: true, order: { id: orderId, reference }, listing: listing.title, quantity,
    accounts, totalNgn: price.totalNgn, discountNgn: price.discountNgn, promoCode: appliedPromo ?? null,
  });
}
