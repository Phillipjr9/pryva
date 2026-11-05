import { beginPurchase } from "@/lib/checkout/purchase";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { orders, users } from "@/db/schema";
import { findGiftCardDenomination } from "@/lib/services/gift-cards/brand-catalog";
import {
  createFoxreloadOrder,
  isFoxreloadConfigured,
  payFoxreloadOrder,
  pollFoxreloadOrderCodes,
  resolveFoxreloadProductId,
  FoxreloadError,
} from "@/lib/providers/foxreload";
import { FOXRELOAD_PROVIDER } from "@/lib/services/order-providers";
import { creditWalletInTx, debitWalletInTx, makeReference } from "@/lib/payments/wallet";
import { scheduleWalletEmails } from "@/lib/email/schedule-wallet-emails";

export const dynamic = "force-dynamic";

/**
 * POST /api/gift-cards/order — buy a *brand* voucher from the supplier.
 *
 * Not to be confused with `/api/gift-cards/purchase`, which mints Pryva-issued
 * wallet credit. Two products, one URL prefix: this one spends wallet money with
 * a supplier, so it can fail at delivery and needs the refund/review path below;
 * the credit path cannot fail that way because it issues the code itself.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const begun = await beginPurchase(request, {
    bucket: "gift-card-order",
    maxBodyBytes: 16 * 1024,
    copy: {
      unavailable: "Gift card purchases are unavailable in this environment.",
      limiterDown: "Gift card purchases are temporarily unavailable.",
      bodyTooLarge: "Request payload too large.",
      invalidBody: "Invalid JSON.",
    },
    // A mock feed is a closed shop: refusing here costs no catalogue read and
    // matches the environment rule the financial gate applies to everything else.
    supplierGate: {
      open: () => process.env.FOXRELOAD_IS_MOCK !== "true",
      message: "Gift card purchases are unavailable in this environment.",
    },
  });
  if (!begun.ok) return begun.response;
  const { user, body } = begun;

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
    return Response.json({ ok: false, error: "Invalid purchase request. Please refresh and try again." }, { status: 400 });
  }
  const requestId = rawRequestId.trim().toLowerCase();

  // Real API requirement: ensure live fulfillment provider is configured
  if (!isFoxreloadConfigured()) {
    return Response.json(
      { ok: false, error: "Gift card purchases are unavailable right now." },
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
        { ok: false, error: "This order was refunded. Check your orders and wallet or contact support before placing another order." },
        { status: 409 },
      );
    }
    return Response.json(
      { ok: false, error: "This order is still being checked. Check your orders and wallet or contact support before placing another order." },
      { status: 409 },
    );
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
      if (!replayed || replayed.status !== "delivered" || !replayed.referenceCode) {
        return Response.json(
          { ok: false, error: replayed?.status === "refunded"
            ? "This order was refunded. Check your orders and wallet or contact support before placing another order."
            : "This order is still being checked. Check your orders and wallet or contact support before placing another order." },
          { status: 409 },
        );
      }
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
    return Response.json(
      { ok: false, error: "We couldn't confirm this order. Check your orders and wallet or contact support before trying again." },
      { status: 500 },
    );
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

    const upstreamOrder = await createFoxreloadOrder({
      itemId: foxreloadItemId,
      quantity: 1,
      idempotencyKey: requestId,
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
    // Delivery can trigger the first-purchase milestone after the debit.
    scheduleWalletEmails();

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
  } catch (err: unknown) {
    // Supplier messages may contain arbitrary response text. Keep only bounded
    // diagnostic identifiers in server logs, never in customer copy or order notes.
    const code = err instanceof FoxreloadError && typeof err.code === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(err.code)
      ? err.code : "UNKNOWN";
    const status = err instanceof FoxreloadError && Number.isInteger(err.status) && err.status >= 100 && err.status <= 599
      ? err.status : null;
    console.error("Gift card delivery could not be confirmed", { reference, code, status });

    let refunded = false;
    try {
      // One transaction, like the debit above: money moving back and the order
      // saying it moved are one event. If the commit acknowledgement is lost,
      // the result is unknown until an operator checks the ledger.
      await db.transaction(async (tx) => {
        await creditWalletInTx(tx, {
          userId: user.id,
          amount: denomination.priceNgn,
          type: "refund",
          description: `Refund · ${card.name} ($${denomination.amountUsd})`,
          orderId,
          reference: makeReference("RFB"),
        });

        await tx
          .update(orders)
          .set({
            status: "refunded",
            refundedAt: new Date(),
            providerRequestId: providerOrderId || null,
            reconciliationNote: "Gift card delivery could not be confirmed.",
          })
          .where(eq(orders.id, orderId));
      });
      refunded = true;
    } catch (refundErr) {
      // A transaction error can also mean the commit acknowledgement was lost.
      // Flag an unsettled row, but never overwrite a refund that did commit.
      console.error("Critical: Failed to auto-refund gift card order", refundErr);
      try {
        await db
          .update(orders)
          .set({
            status: "review",
            providerRequestId: providerOrderId || null,
            reconciliationNote: "Gift card delivery and automatic refund could not be confirmed.",
          })
          .where(and(eq(orders.id, orderId), isNull(orders.refundedAt)));
      } catch (noteError) {
        console.error("Critical: could not flag gift card order for review", noteError);
      }
    }
    // The credit committed inside the transaction, so schedule its receipt only
    // after that outcome is known. A lost acknowledgement is not confirmation.
    if (refunded) scheduleWalletEmails();

    return Response.json(
      {
        ok: false,
        outcome: refunded ? "refunded" : "unconfirmed",
        reference,
        error: refunded
          ? "We couldn't confirm your gift card delivery. Your wallet has been refunded. Check your orders or contact support before placing another order."
          : `We couldn't confirm your gift card delivery or refund. Check your orders and wallet, then contact support with reference ${reference} before ordering again.`,
      },
      { status: 502 },
    );
  }
}
