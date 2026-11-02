import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { orders, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  createFoxreloadOrder,
  FoxreloadError,
  getFoxreloadProduct,
  payFoxreloadOrder,
  pollFoxreloadOrderCodes,
} from "@/lib/foxreload";
import { checkMargin, MARGIN_BLOCKED_MESSAGE } from "@/lib/margin-guard";
import { isSameOriginMutation } from "@/lib/net";
import { FOXRELOAD_PROVIDER } from "@/lib/order-providers";
import { purchaseRateLimiter } from "@/lib/rate-limit";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { scheduleWalletEmails } from "@/lib/schedule-wallet-emails";
import { supplierAmountToNgn } from "@/lib/supplier-currency";
import {
  resolveMappedProduct,
  mappingMissingRequirements,
  type MappedPlan,
  type ProductFamily,
} from "@/lib/product-mappings";
import { creditWallet, debitWalletInTx, makeReference } from "@/lib/wallet";

/**
 * One purchase path for the three catalogue families that had no supplier.
 *
 * It deliberately reuses exactly the FoxReload order/pay/poll sequence that
 * gift cards already use, and the same debit-then-refund compensation that route
 * uses for FoxReload specifically. Nothing here invents a supplier contract:
 *
 *  • the plan and its naira price come from our own catalogue;
 *  • the product ID comes from an operator-written mapping file;
 *  • the delivery type, price and currency are read back from FoxReload's live
 *    product before any money moves, and a product that does not deliver a code
 *    is refused — direct top-ups need a recipient contract we have not verified;
 *  • the margin guard refuses a mapping whose real cost does not fit the price;
 *  • the wallet is debited only after those checks, and is credited back (or the
 *    order is parked in `review`) if anything upstream fails.
 *
 * An unmapped plan still returns an actionable 503. That is the steady state of
 * a fresh deployment, not an error to hide: the old routes said only "not
 * available yet", which gave an operator nothing to act on.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16 * 1024;

type Receipt = {
  ok: true;
  replayed: boolean;
  balance: number;
  reference: string;
  code: string | null;
  orderId: string;
  product: { family: ProductFamily; planId: string; name: string; label: string; price: number };
};

function receiptOf(order: {
  id: string;
  reference: string;
  referenceCode: string | null;
  service: string;
  productName: string;
  planLabel: string;
  amount: number;
  productSlug: string;
}, product: MappedPlan, balance: number, replayed: boolean): Receipt {
  return {
    ok: true,
    replayed,
    balance,
    reference: order.reference,
    code: order.referenceCode,
    orderId: order.id,
    product: {
      family: product.family,
      planId: product.planId,
      name: product.productName,
      label: product.planLabel,
      price: product.price,
    },
  };
}

function fail(error: string, status: number, extra: Record<string, unknown> = {}) {
  return Response.json({ ok: false, error, ...extra }, { status });
}

export async function purchaseMappedProduct(request: Request, family: ProductFamily): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return fail("Please sign in to complete this order.", 401);
  if (!isSameOriginMutation(request)) return fail("Cross-origin request denied.", 403);
  if (!isJsonRequest(request)) return fail("Expected JSON.", 415);

  const limit = await purchaseRateLimiter(`supplier-product:${family}:${user.id}`);
  if (limit.unavailable) return fail("Purchases are temporarily unavailable.", 503);
  if (!limit.allowed) return fail("Too many attempts. Try again later.", 429);

  let body: unknown;
  try {
    body = await readJsonWithLimit(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return fail("Request payload too large.", 413);
    return fail("Invalid JSON.", 400);
  }

  const { planId: rawPlanId, requestId: rawRequestId } = (body && typeof body === "object" ? body : {}) as {
    planId?: unknown;
    requestId?: unknown;
  };
  if (typeof rawPlanId !== "string" || !rawPlanId.trim()) return fail("Please select a plan.", 400);
  if (typeof rawRequestId !== "string" || !UUID.test(rawRequestId.trim())) {
    return fail("A valid requestId UUID is required.", 400);
  }
  const planId = rawPlanId.trim();
  const requestId = rawRequestId.trim().toLowerCase();

  const missing = mappingMissingRequirements(family);
  if (missing.length) {
    // The operator gets the exact list from /api/diagnostics/product-mappings.
    // A shopper must never read configuration, product IDs or sourcing detail —
    // the owner rule covers JSON fields a customer can see in devtools too.
    console.warn("Mapped product purchases unavailable", { family, missing });
    return fail("This service is not available for purchase yet.", 503);
  }

  const product = resolveMappedProduct(family, planId);
  if (!product) {
    return fail("That plan is not available for purchase yet.", 404);
  }

  const [currentUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (!currentUser || currentUser.walletBalance < product.price) {
    return fail("Insufficient wallet balance.", 402);
  }

  const [existing] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.userId, user.id), eq(orders.requestId, requestId)))
    .limit(1);
  if (existing) {
    if (existing.status === "delivered") {
      return Response.json(receiptOf(existing, product, currentUser.walletBalance, true));
    }
    if (existing.status === "refunded") {
      return fail("This order was previously refunded. Please try again with a new request.", 409);
    }
    return fail("That order is still being processed. Check your orders before retrying.", 409);
  }

  // Pre-flight read. No order is placed and nothing is charged here: a product
  // FoxReload says is not code-delivered, or one whose real cost breaks the
  // margin floor, must never reach the wallet at all.
  try {
    const upstream = await getFoxreloadProduct(product.productId);
    if (upstream.deliveryType.trim().toLowerCase() !== "code") {
      throw new FoxreloadError(
        "That supplier product does not deliver a code, so Pryva cannot verify delivery.",
        503,
        "UNVERIFIED_DELIVERY_TYPE",
      );
    }
    const costNgn = await supplierAmountToNgn(upstream.price, upstream.currency);
    if (!checkMargin(product.price, costNgn).ok) {
      // Wholesale cost stays in the server log; the customer sees no economics.
      console.error("Supplier product margin refused", { family, planId, costNgn, price: product.price });
      return fail(MARGIN_BLOCKED_MESSAGE, 503);
    }
  } catch (error) {
    if (error instanceof FoxreloadError) {
      return fail("That product cannot be delivered yet. Nothing was charged.", error.status || 503);
    }
    console.error("Supplier product pre-flight failed", error);
    return fail("The supplier catalogue is temporarily unavailable. Nothing was charged.", 502);
  }

  const orderId = randomUUID();
  const reference = makeReference("SP");
  let balanceAfterDebit: number;
  try {
    balanceAfterDebit = await db.transaction(async (tx) => {
      const [raced] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.userId, user.id), eq(orders.requestId, requestId)))
        .limit(1);
      if (raced) throw new Error("REPLAY_RACED");

      await tx.insert(orders).values({
        id: orderId,
        reference,
        userId: user.id,
        requestId,
        service: product.service,
        productSlug: product.planId,
        productName: product.productName,
        planLabel: product.planLabel,
        region: product.region,
        duration: product.duration,
        amount: product.price,
        status: "processing",
        provider: FOXRELOAD_PROVIDER,
      });

      return await debitWalletInTx(tx, {
        userId: user.id,
        amount: product.price,
        type: "debit",
        description: product.productName,
        orderId,
        reference,
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "REPLAY_RACED") {
      const [replayed] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.userId, user.id), eq(orders.requestId, requestId)))
        .limit(1);
      if (replayed) return Response.json(receiptOf(replayed, product, currentUser.walletBalance, true));
    }
    console.error("Failed to commit supplier product order debit", error);
    return fail("Failed to process this purchase. Nothing was charged.", 500);
  }

  // The debit committed inside its own transaction, so `debitWallet`'s usual
  // nudge never ran. Without this the receipt waits for the nightly backstop.
  scheduleWalletEmails();

  let providerOrderId = "";
  try {
    const upstreamOrder = await createFoxreloadOrder({
      itemId: product.productId,
      quantity: 1,
      idempotencyKey: requestId,
      isMock: process.env.FOXRELOAD_IS_MOCK === "true",
    });
    providerOrderId = upstreamOrder.id;
    await payFoxreloadOrder(upstreamOrder.id);
    const codes = await pollFoxreloadOrderCodes(upstreamOrder.id);
    const code = codes[0] || "";
    if (!code) throw new FoxreloadError("No delivery code received from provider", 502, "NO_CODE");

    await db
      .update(orders)
      .set({ status: "delivered", providerRequestId: providerOrderId, referenceCode: code })
      .where(eq(orders.id, orderId));

    return Response.json({
      ok: true,
      replayed: false,
      balance: balanceAfterDebit,
      reference,
      code,
      orderId,
      product: {
        family: product.family,
        planId: product.planId,
        name: product.productName,
        label: product.planLabel,
        price: product.price,
      },
    });
  } catch (error) {
    const reason = error instanceof FoxreloadError ? error.message : "Fulfillment provider unavailable";
    console.error("Supplier product fulfillment failed, rolling back wallet charge", error);

    let refunded = false;
    try {
      await creditWallet({
        userId: user.id,
        amount: product.price,
        type: "refund",
        description: `Refund · ${product.productName}`,
        orderId,
        reference: makeReference("RFB"),
      });
      await db
        .update(orders)
        .set({
          status: "refunded",
          refundedAt: new Date(),
          providerRequestId: providerOrderId || null,
          reconciliationNote: `Fulfillment failed: ${reason}`,
        })
        .where(eq(orders.id, orderId));
      refunded = true;
    } catch (refundError) {
      // Telling the customer "you were refunded" when the credit failed is a
      // false statement about money. Park the row where an operator can see it.
      console.error("Critical: failed to auto-refund supplier product order", refundError);
      try {
        await db
          .update(orders)
          .set({
            status: "review",
            providerRequestId: providerOrderId || null,
            reconciliationNote: `Fulfillment failed: ${reason}; automatic refund failed — debit still stands`.slice(0, 480),
          })
          .where(eq(orders.id, orderId));
      } catch (noteError) {
        console.error("Critical: could not flag supplier product order for review", noteError);
      }
    }

    return fail(
      refunded
        ? `Delivery failed: ${reason}. Your wallet has been refunded.`
        : `Delivery failed: ${reason}. We could not return the money automatically, so support has been flagged and will refund it. Quote reference ${reference}.`,
      error instanceof FoxreloadError && error.status >= 400 && error.status < 600 ? error.status : 502,
    );
  }
}
