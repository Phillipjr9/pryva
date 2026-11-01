import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { findGiftCardDenomination } from "@/lib/gift-cards-catalog";
import {
  createFoxreloadOrder,
  isFoxreloadConfigured,
  payFoxreloadOrder,
  pollFoxreloadOrderCodes,
  resolveFoxreloadProductId,
  FoxreloadError,
} from "@/lib/foxreload";
import { FOXRELOAD_PROVIDER } from "@/lib/order-providers";
import { creditWallet, debitWalletInTx, makeReference } from "@/lib/wallet";
import { scheduleWalletEmails } from "@/lib/schedule-wallet-emails";
import { isSameOriginMutation } from "@/lib/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { purchaseRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ ok: false, error: "Please sign in to complete this order." }, { status: 401 });
  }

  if (!isSameOriginMutation(request)) {
    return Response.json({ ok: false, error: "Cross-origin request denied." }, { status: 403 });
  }

  if (!isJsonRequest(request)) {
    return Response.json({ ok: false, error: "Expected JSON." }, { status: 415 });
  }

  const limit = await purchaseRateLimiter(`gift-card-order:${user.id}`);
  if (limit.unavailable) {
    return Response.json({ ok: false, error: "Gift card purchases are temporarily unavailable." }, { status: 503 });
  }
  if (!limit.allowed) {
    return Response.json({ ok: false, error: "Too many attempts. Try again later." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await readJsonWithLimit(request, 16 * 1024);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return Response.json({ ok: false, error: "Request payload too large." }, { status: 413 });
    }
    return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const { denominationId, requestId: rawRequestId } = (body && typeof body === "object" ? body : {}) as {
    denominationId?: unknown;
    requestId?: unknown;
  };

  if (typeof denominationId !== "string" || !denominationId.trim()) {
    return Response.json({ ok: false, error: "Please select a gift card denomination." }, { status: 400 });
  }

  const found = findGiftCardDenomination(denominationId.trim());
  if (!found) {
    return Response.json({ ok: false, error: "Gift card denomination not found." }, { status: 404 });
  }

  const { card, denomination } = found;

  if (typeof rawRequestId !== "string" || !UUID.test(rawRequestId.trim())) {
    return Response.json({ ok: false, error: "A valid requestId UUID is required." }, { status: 400 });
  }
  const requestId = rawRequestId.trim().toLowerCase();

  // Real API requirement: ensure live fulfillment provider is configured
  if (!isFoxreloadConfigured()) {
    return Response.json(
      { ok: false, error: "Live gift card purchases are currently unavailable. Provider API is not configured." },
      { status: 503 },
    );
  }

  // Check current wallet balance
  const [currentUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (!currentUser || currentUser.walletBalance < denomination.priceNgn) {
    return Response.json({ ok: false, error: "Insufficient wallet balance." }, { status: 402 });
  }

  // Idempotency: check if already bought
  const [existing] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.userId, user.id), eq(orders.requestId, requestId)))
    .limit(1);

  if (existing) {
    if (existing.status === "delivered" && existing.referenceCode) {
      return Response.json({
        ok: true,
        replayed: true,
        balance: currentUser.walletBalance,
        reference: existing.reference,
        code: existing.referenceCode,
        card: {
          id: card.slug,
          name: card.name,
          denomination: `$${denomination.amountUsd} USD`,
          instructions: card.redemptionGuide,
        },
      });
    }
    if (existing.status === "refunded") {
      return Response.json(
        { ok: false, error: "This order was previously refunded. Please try again with a new request." },
        { status: 409 },
      );
    }
  }

  const orderId = randomUUID();
  const reference = makeReference("GC");

  // Step 1: Record order as 'processing' and debit wallet atomically
  let balanceAfterDebit: number;
  try {
    balanceAfterDebit = await db.transaction(async (tx) => {
      // Re-check for race conditions
      const [raced] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.userId, user.id), eq(orders.requestId, requestId)))
        .limit(1);

      if (raced) {
        throw new Error("REPLAY_RACED");
      }

      await tx.insert(orders).values({
        id: orderId,
        reference,
        userId: user.id,
        requestId,
        service: "gift-cards",
        productSlug: denomination.id,
        productName: card.name,
        planLabel: `$${denomination.amountUsd} USD Voucher`,
        region: card.region,
        duration: "Digital Gift Card",
        amount: denomination.priceNgn,
        status: "processing",
        provider: FOXRELOAD_PROVIDER,
      });

      return await debitWalletInTx(tx, {
        userId: user.id,
        amount: denomination.priceNgn,
        type: "debit",
        description: `${card.name} ($${denomination.amountUsd})`,
        orderId,
        reference,
      });
    });
  } catch (error: any) {
    if (error?.message === "REPLAY_RACED") {
      const [replayed] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.userId, user.id), eq(orders.requestId, requestId)))
        .limit(1);
      return Response.json({
        ok: true,
        replayed: true,
        balance: currentUser.walletBalance,
        reference: replayed.reference,
        code: replayed.referenceCode,
        card: {
          id: card.slug,
          name: card.name,
          denomination: `$${denomination.amountUsd} USD`,
          instructions: card.redemptionGuide,
        },
      });
    }
    console.error("Failed to commit gift card order debit", error);
    return Response.json({ ok: false, error: "Failed to process gift card purchase." }, { status: 500 });
  }

  // The debit committed with its own transaction, so `debitWallet`'s usual nudge
  // never ran here. Without this the receipt waits for the nightly backstop.
  scheduleWalletEmails();

  // Step 2: Execute real FoxReload API purchase
  let voucherCode = "";
  let providerOrderId = "";

  try {
    const foxreloadItemId = await resolveFoxreloadProductId({
      brand: card.name,
      amountUsd: denomination.amountUsd,
      preferredId: denomination.foxreloadProductId || denomination.id,
    });

    const isMock = process.env.FOXRELOAD_IS_MOCK === "true";

    const upstreamOrder = await createFoxreloadOrder({
      itemId: foxreloadItemId,
      quantity: 1,
      idempotencyKey: requestId,
      isMock,
    });
    providerOrderId = upstreamOrder.id;

    await payFoxreloadOrder(upstreamOrder.id);
    const codes = await pollFoxreloadOrderCodes(upstreamOrder.id);
    voucherCode = codes[0] || "";

    if (!voucherCode) {
      throw new FoxreloadError("No voucher code received from provider", 502, "NO_CODE");
    }

    // Step 3: Mark order delivered with code
    await db
      .update(orders)
      .set({
        status: "delivered",
        providerRequestId: providerOrderId,
        referenceCode: voucherCode,
      })
      .where(eq(orders.id, orderId));

    return Response.json({
      ok: true,
      replayed: false,
      balance: balanceAfterDebit,
      reference,
      code: voucherCode,
      card: {
        id: card.slug,
        name: card.name,
        denomination: `$${denomination.amountUsd} USD`,
        instructions: card.redemptionGuide,
      },
    });
  } catch (err: any) {
    console.error("FoxReload order fulfillment failed, rolling back wallet charge", err);
    // Step 4: Reverse wallet debit and mark order as refunded
    const errorMessage =
      err instanceof FoxreloadError
        ? err.message
        : "Fulfillment provider unavailable";

    try {
      await creditWallet({
        userId: user.id,
        amount: denomination.priceNgn,
        type: "refund",
        description: `Refund · ${card.name} ($${denomination.amountUsd})`,
        orderId,
        reference: makeReference("RFB"),
      });

      await db
        .update(orders)
        .set({
          status: "refunded",
          refundedAt: new Date(),
          providerRequestId: providerOrderId || null,
          reconciliationNote: `Fulfillment failed: ${errorMessage}`,
        })
        .where(eq(orders.id, orderId));
    } catch (refundErr) {
      console.error("Critical: Failed to auto-refund gift card order", refundErr);
    }

    return Response.json(
      {
        ok: false,
        error: `Gift card fulfillment failed: ${errorMessage}. Your wallet has been refunded.`,
      },
      { status: err instanceof FoxreloadError && err.status >= 400 && err.status < 600 ? err.status : 502 },
    );
  }
}
