import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, users, type Order } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { findGiftCardDenomination } from "@/lib/gift-cards-catalog";
import {
  createFoxreloadOrder,
  getFoxreloadProduct,
  isFoxreloadConfigured,
  payFoxreloadOrder,
  pollFoxreloadOrderCodes,
  FoxreloadError,
} from "@/lib/foxreload";
import { FOXRELOAD_PROVIDER, PREVIEW_PROVIDER } from "@/lib/order-providers";
import { debitWalletInTx, makeReference } from "@/lib/wallet";
import { isSameOriginMutation } from "@/lib/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { purchaseRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function generateSimulatedCode(brandSlug: string): string {
  const prefix = brandSlug.toUpperCase().slice(0, 4);
  const part1 = Math.random().toString(36).substring(2, 6).toUpperCase();
  const part2 = Math.random().toString(36).substring(2, 6).toUpperCase();
  const part3 = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${part1}-${part2}-${part3}`;
}

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

  let voucherCode = "";
  let providerRequestId: string | null = null;
  let providerCostNgn: number | null = null;
  const isLive = isFoxreloadConfigured();

  if (isLive) {
    try {
      const order = await createFoxreloadOrder({
        itemId: denomination.id,
        quantity: 1,
      });
      providerRequestId = order.id;
      await payFoxreloadOrder(order.id);
      const codes = await pollFoxreloadOrderCodes(order.id);
      voucherCode = codes[0] || "";
      if (!voucherCode) {
        throw new FoxreloadError("No voucher code received from provider", 502, "NO_CODE");
      }
    } catch (error) {
      if (error instanceof FoxreloadError) {
        return Response.json(
          { ok: false, error: `Supplier order failed: ${error.message}` },
          { status: error.status >= 400 && error.status < 600 ? error.status : 502 },
        );
      }
      return Response.json(
        { ok: false, error: "Gift card fulfillment failed. Your wallet was not charged." },
        { status: 502 },
      );
    }
  } else {
    // Sandbox / preview fulfillment
    voucherCode = generateSimulatedCode(card.brand);
  }

  const orderId = randomUUID();
  const reference = makeReference("GC");

  try {
    const outcome = await db.transaction(async (tx) => {
      // Re-check for concurrency
      const [raced] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.userId, user.id), eq(orders.requestId, requestId)))
        .limit(1);

      if (raced) {
        return { replayed: true, order: raced, balance: currentUser.walletBalance };
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
        status: "delivered",
        provider: isLive ? FOXRELOAD_PROVIDER : PREVIEW_PROVIDER,
        providerRequestId,
        providerCostNgn,
        referenceCode: voucherCode,
      });

      const newBalance = await debitWalletInTx(tx, {
        userId: user.id,
        amount: denomination.priceNgn,
        type: "debit",
        description: `${card.name} ($${denomination.amountUsd})`,
        orderId,
        reference,
      });

      return { replayed: false, balance: newBalance };
    });

    return Response.json({
      ok: true,
      replayed: outcome.replayed,
      balance: outcome.balance,
      reference,
      code: voucherCode,
      card: {
        id: card.slug,
        name: card.name,
        denomination: `$${denomination.amountUsd} USD`,
        instructions: card.redemptionGuide,
      },
    });
  } catch (error) {
    console.error("Failed to commit gift card order transaction", error);
    return Response.json({ ok: false, error: "Failed to process gift card purchase." }, { status: 500 });
  }
}
