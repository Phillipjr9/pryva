import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { purchaseRateLimiter } from "@/lib/rate-limit";
import { debitWallet, creditWallet, makeReference, InsufficientFundsError } from "@/lib/wallet";
import {
  AccsZoneError,
  getListing,
  isAccsZoneConfigured,
  purchaseAccounts,
  validatePromo,
  type AccsZonePurchase,
} from "@/lib/accszone";
import { applyPromoDiscount, priceMarketplaceListing } from "@/lib/marketplace-pricing";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_QUANTITY = 50;

/** Map provider error codes to shopper-safe text. Never mention the supplier. */
function customerMessage(code: string, retryAfter?: number): string {
  switch (code) {
    case "insufficient_stock":
      return "Not enough stock for that quantity. Try a smaller amount.";
    case "insufficient_accounts":
      return "Fewer accounts were available than requested. Try a smaller quantity.";
    case "listing_unavailable":
    case "listing_not_found":
      return "That listing is no longer available.";
    case "rate_limit_exceeded":
      return `We're a little busy right now. Please retry in ${retryAfter ?? 30} seconds.`;
    case "not_configured":
      return "Accounts are temporarily unavailable.";
    case "timeout":
    case "network_error":
      return "The order is taking longer than expected. Your wallet has been refunded — contact support with your reference.";
    case "insufficient_balance":
      return "Accounts are temporarily unavailable. You have not been charged.";
    default:
      return "That purchase could not be completed. You have not been charged.";
  }
}

async function refund(params: {
  userId: string;
  orderId: string;
  amount: number;
  reference: string;
}): Promise<void> {
  try {
    await creditWallet({
      userId: params.userId,
      amount: params.amount,
      type: "refund",
      description: `Automatic refund — order ${params.reference}`,
      orderId: params.orderId,
      reference: makeReference("RFD"),
    });
    await db
      .update(orders)
      .set({ status: "refunded", refundedAt: new Date() })
      .where(eq(orders.id, params.orderId));
  } catch (error) {
    // If the refund itself fails, shout loudly — a human must fix this.
    logger.error("MARKETPLACE REFUND FAILED — manual action required", {
      orderId: params.orderId,
      reference: params.reference,
      amount: params.amount,
      userId: params.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * POST /api/accounts/purchase
 * body: { slug: string, quantity: number }
 *
 * Money-safety sequence:
 *   1. Re-read the listing server-side (the client never sends a price)
 *   2. Debit the wallet atomically
 *   3. Create the order
 *   4. Buy upstream with a `client_reference`, retrying once on timeout with the
 *      SAME reference so a dropped connection can't buy twice
 *   5. On any failure → refund the wallet and mark the order refunded
 */
export async function POST(request: NextRequest) {
  if (!isAccsZoneConfigured()) {
    return NextResponse.json({ error: "Accounts are temporarily unavailable." }, { status: 503 });
  }

  const user = await requireAuth(request);
  if (!user) {
    return NextResponse.json({ error: "Please sign in to buy accounts." }, { status: 401 });
  }

  const limit = await purchaseRateLimiter(`accounts-purchase:${user.id}`);
  if (!limit.allowed) {
    const seconds = Math.max(1, Math.ceil((limit.resetTime - Date.now()) / 1000));
    return NextResponse.json({ error: `Too many attempts. Try again in ${seconds}s.` }, { status: 429 });
  }

  let body: { slug?: unknown; quantity?: unknown; promoCode?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const quantityRaw = typeof body.quantity === "number" ? body.quantity : Number(body.quantity);

  if (!slug || slug.length > 200) {
    return NextResponse.json({ error: "Invalid listing" }, { status: 400 });
  }
  if (!Number.isInteger(quantityRaw) || quantityRaw < 1 || quantityRaw > MAX_QUANTITY) {
    return NextResponse.json({ error: `Quantity must be between 1 and ${MAX_QUANTITY}` }, { status: 400 });
  }
  const quantity = quantityRaw;
  const promoCode =
    typeof body.promoCode === "string" && body.promoCode.trim()
      ? body.promoCode.trim().toUpperCase().slice(0, 40)
      : undefined;

  // 1. Authoritative listing lookup.
  let listing;
  try {
    listing = await getListing(slug);
  } catch (error) {
    const code = error instanceof AccsZoneError ? error.code : "unknown_error";
    return NextResponse.json({ error: customerMessage(code) }, { status: 404 });
  }

  if (listing.available_stock < quantity) {
    return NextResponse.json(
      {
        error: `Only ${listing.available_stock} left in stock.`,
        available: listing.available_stock,
      },
      { status: 409 },
    );
  }

  const basePrice = await priceMarketplaceListing({
    unitPriceUsd: listing.price,
    quantity,
    categoryTitle: listing.category?.title,
    subcategoryTitle: listing.subcategory?.title,
  });

  // Re-validate the promo server-side: the client's "applied" badge is only a hint.
  let price = basePrice;
  let appliedPromo: string | undefined;
  if (promoCode) {
    try {
      const basketUsd = ((Number(listing.price) * quantity) || 0).toFixed(2);
      const promo = await validatePromo(promoCode, Number(basketUsd));
      const discounted = applyPromoDiscount(basePrice, promo.discount);
      if (discounted.totalNgn < basePrice.totalNgn) {
        price = discounted;
        appliedPromo = promoCode;
      }
    } catch {
      // Code stopped working between validation and checkout — charge normal price.
      logger.info("Marketplace promo dropped at checkout", { promoCode, userId: user.id });
    }
  }

  // 2. Debit first — if the wallet can't cover it, nothing else happens.
  const orderReference = makeReference("MKT");
  let walletReference: string;
  try {
    walletReference = await debitWallet({
      userId: user.id,
      amount: price.totalNgn,
      type: "debit",
      description: `Accounts purchase — ${listing.title}${appliedPromo ? ` (promo ${appliedPromo})` : ""}`.slice(0, 200),
      reference: orderReference,
    }).then(() => orderReference);
  } catch (error) {
    if (error instanceof InsufficientFundsError) {
      return NextResponse.json(
        {
          error: "Insufficient wallet balance.",
          balance: error.balance,
          required: error.required,
        },
        { status: 402 },
      );
    }
    logger.error("Marketplace spend failed", { error, userId: user.id });
    return NextResponse.json({ error: "Could not debit your wallet. Nothing was charged." }, { status: 500 });
  }

  // 3. Record the order before calling the provider so a crash still leaves a trail.
  const clientReference = randomUUID();
  let orderId: string;
  try {
    const inserted = await db
      .insert(orders)
      .values({
        reference: orderReference,
        userId: user.id,
        service: "accounts",
        productSlug: listing.slug,
        productName: listing.title,
        planLabel: `${quantity} × account`,
        region: listing.category?.title ?? "Global",
        duration: "Instant delivery",
        amount: price.totalNgn,
        status: "processing",
        provider: "accounts",
        providerRequestId: clientReference,
        referenceCode: null,
        accounts: null,
      })
      .returning({ id: orders.id });

    const created = inserted[0];
    if (!created) throw new Error("Order insert returned no row");
    orderId = created.id;
  } catch (error) {
    logger.error("Marketplace order insert failed — refunding", { error, userId: user.id });
    await creditWallet({
      userId: user.id,
      amount: price.totalNgn,
      type: "refund",
      description: `Refund — order ${walletReference}`,
      reference: makeReference("RFD"),
    });
    return NextResponse.json({ error: "Could not create your order. Nothing was charged." }, { status: 500 });
  }

  // 4. Buy upstream. Retry exactly once on an ambiguous network outcome,
  //    reusing the same client_reference so the provider can't double-charge.
  let purchase: AccsZonePurchase | null = null;
  let failureCode = "unknown_error";
  try {
    purchase = await purchaseAccounts({
      listingId: listing.id,
      quantity,
      clientReference,
      promoCode: appliedPromo,
    });
  } catch (error) {
    const first = error instanceof AccsZoneError ? error : null;
    failureCode = first?.code ?? "unknown_error";

    if (failureCode === "timeout" || failureCode === "network_error") {
      try {
        purchase = await purchaseAccounts({
      listingId: listing.id,
      quantity,
      clientReference,
      promoCode: appliedPromo,
    });
      } catch (retryError) {
        failureCode = retryError instanceof AccsZoneError ? retryError.code : "unknown_error";
        logger.error("Marketplace purchase ambiguous after retry — refunding", {
          orderReference,
          clientReference,
          code: failureCode,
          userId: user.id,
        });
      }
    }
  }

  // 5a. Success — store credentials and mark delivered.
  if (purchase) {
    try {
      await db
        .update(orders)
        .set({
          status: "delivered",
          referenceCode: String(purchase.order_id),
          accounts: JSON.stringify(purchase.accounts ?? []),
        })
        .where(eq(orders.id, orderId));
    } catch (error) {
      // Accounts are already bought; the user paid and must get them.
      logger.error("MARKETPLACE DELIVERY SAVE FAILED — credentials in response only", {
        orderReference,
        clientReference,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.info("Marketplace purchase delivered", {
      orderReference,
      providerOrderId: purchase.order_id,
      quantity,
      totalNgn: price.totalNgn,
      profitNgn: price.profitNgn,
      promo: appliedPromo ?? null,
      replayed: Boolean(purchase.replayed),
    });

    return NextResponse.json({
      ok: true,
      order: { id: orderId, reference: orderReference },
      listing: listing.title,
      quantity,
      accounts: purchase.accounts ?? [],
      totalNgn: price.totalNgn,
      discountNgn: price.discountNgn,
      promoCode: appliedPromo ?? null,
    });
  }

  // 5b. Failure — refund in full.
  await refund({ userId: user.id, orderId, amount: price.totalNgn, reference: orderReference });

  const retryAfter = undefined;
  return NextResponse.json(
    {
      error: customerMessage(failureCode, retryAfter),
      refunded: true,
      order: { id: orderId, reference: orderReference },
    },
    { status: 502 },
  );
}
