import { afterPurchase, beginPurchase } from "@/lib/checkout/purchase";
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, users, walletTransactions } from "@/db/schema";
import { MarketplaceError, purchaseMarketplaceListing } from "@/lib/services/accounts/marketplace-suppliers";
import { isMarketplaceCheckoutConfigured } from "@/lib/services/accounts/marketplace-policy";
import { isManualFulfilmentReachable } from "@/lib/services/accounts/manual-fulfilment";
import { isManualSlug } from "@/lib/services/accounts/manual-catalog";
import { ACCOUNTS_PROVIDER, MANUAL_PROVIDER } from "@/lib/services/order-providers";
import { fulfilmentLabel } from "@/lib/services/warranty";
import { calculateMarketplaceCheckoutQuote, marketplaceQuoteError, MAX_MARKETPLACE_QUANTITY, publicMarketplaceCheckoutQuote } from "@/lib/services/accounts/marketplace-checkout-quote";
import { logger } from "@/lib/platform/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const begun = await beginPurchase<{ slug?: unknown; quantity?: unknown; promoCode?: unknown; requestId?: unknown; expectedTotalNgn?: unknown; expectedTerms?: unknown }>(
    request,
    {
      bucket: "accounts-purchase",
      maxBodyBytes: 4_096,
      copy: {
        unauthorized: "Please sign in to buy accounts.",
        // This route used to say how long the wait was; the shared limiter knows
        // the window, so it keeps saying it rather than falling back to "later".
        rateLimited: (retryAfterMs) => `Too many attempts. Try again in ${Math.max(1, Math.ceil(retryAfterMs / 1000))}s.`,
      },
      supplierGate: {
        open: isMarketplaceCheckoutConfigured,
        message: "Account purchases are temporarily unavailable.",
      },
    },
  );
  if (!begun.ok) return begun.response;
  const { user } = begun;
  if (!begun.body || typeof begun.body !== "object" || Array.isArray(begun.body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const body = begun.body;


  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const quantity = typeof body.quantity === "number" ? body.quantity : Number(body.quantity);
  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  if (!slug || slug.length > 80 || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_MARKETPLACE_QUANTITY || !UUID.test(requestId)) {
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

  // A repeat of the same request must return its existing receipt/review state,
  // even if a quote is now missing or the item is no longer available.
  try {
    const [previous] = await db.select().from(orders)
      .where(and(eq(orders.userId, user.id), eq(orders.reference, reference))).limit(1);
    if (previous) return existingResponse(previous, slug, quantity);
  } catch {
    return pendingResponse(reference);
  }

  // Old clients must refresh rather than paying an amount they did not review.
  if (typeof body.expectedTotalNgn !== "number" || !Number.isSafeInteger(body.expectedTotalNgn) ||
      body.expectedTotalNgn <= 0 || body.expectedTotalNgn > 2_147_483_647 ||
      typeof body.expectedTerms !== "string" || !/^[a-f0-9]{24}$/.test(body.expectedTerms)) {
    return NextResponse.json({ error: "Review the current price before ordering. Refresh the page if needed.", code: "quote_required" }, { status: 400 });
  }

  // A hand-prepared item is buyable only when an administrator can prepare it.
  if (isManual && !(await isManualFulfilmentReachable())) {
    return NextResponse.json({ error: "This item cannot be prepared right now." }, { status: 503 });
  }

  let listing;
  let price;
  const appliedPromo = promoCode || undefined;
  try {
    // The same calculator powers the review endpoint and this fresh recheck.
    // Neither the client-provided total nor its terms can set the charged amount.
    const current = await calculateMarketplaceCheckoutQuote({ slug, quantity, promoCode });
    listing = current.listing;
    price = current.price;
    const publicQuote = publicMarketplaceCheckoutQuote(current);
    if (body.expectedTotalNgn !== price.totalNgn || body.expectedTerms !== publicQuote.terms) {
      // A concurrent replay may have committed while we were rechecking.
      try {
        const [previous] = await db.select().from(orders)
          .where(and(eq(orders.userId, user.id), eq(orders.reference, reference))).limit(1);
        if (previous) return existingResponse(previous, slug, quantity);
      } catch {
        return pendingResponse(reference);
      }
      return NextResponse.json({
        error: "The price or item details changed. Review the updated quote before confirming.",
        code: "quote_changed", quote: publicQuote,
      }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
  } catch (error) {
    const failure = marketplaceQuoteError(error);
    return NextResponse.json(failure.body, { status: failure.status });
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
        provider: isManual ? MANUAL_PROVIDER : ACCOUNTS_PROVIDER,
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
    void afterPurchase(user.id);
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
  void afterPurchase(user.id);
  return NextResponse.json({
    ok: true, order: { id: orderId, reference }, listing: listing.title, quantity,
    accounts, totalNgn: price.totalNgn, discountNgn: price.discountNgn, promoCode: appliedPromo ?? null,
  });
}
