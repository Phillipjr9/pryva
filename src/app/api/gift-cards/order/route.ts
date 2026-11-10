import { beginPurchase } from "@/lib/checkout/purchase";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { orders, users } from "@/db/schema";
import { findGiftCardDenomination } from "@/lib/services/gift-cards/brand-catalog";
import { legacyBrandGiftCardSalesEnabled } from "@/lib/services/gift-cards/brand-readiness";
import {
  createFoxreloadOrder,
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
    return Response.json({ ok: false, error: "A valid requestId UUID is required." }, { status: 400 });
  }
  const requestId = rawRequestId.trim().toLowerCase();

  // Resolve the request key before checking today's balance: an already-paid
  // replay must not be rejected simply because the first debit reduced it.
  const [currentUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  const replay = (existing: typeof orders.$inferSelect) => {
    if (existing.productSlug !== denomination.id || existing.provider !== FOXRELOAD_PROVIDER) {
      return Response.json({ ok: false, error: "This request ID belongs to a different order." }, { status: 409 });
    }
    if (existing.status === "delivered" && existing.referenceCode) {
      return Response.json({ ok: true, replayed: true, balance: currentUser?.walletBalance, reference: existing.reference,
        code: existing.referenceCode, card: { id: card.slug, name: card.name, denomination: `$${denomination.amountUsd} USD`, instructions: card.redemptionGuide } });
    }
    if (existing.status === "refunded") {
      return Response.json({ ok: false, safeToRetry: true, error: "This attempt was refunded. Check your wallet before starting a new purchase." }, { status: 409 });
    }
    return Response.json({ ok: false, pending: true, reference: existing.reference,
      error: "This purchase is still being checked. Contact support with the reference before buying again." }, { status: 409 });
  };
  const [existing] = await db.select().from(orders)
    .where(and(eq(orders.userId, user.id), eq(orders.requestId, requestId))).limit(1);
  if (existing) return replay(existing);
  // Recovery of an existing order must work even while the provider is offline.
  if (!legacyBrandGiftCardSalesEnabled()) {
    return Response.json({ ok: false, error: "Brand gift card purchases are currently unavailable. Check your orders for previous purchases." }, { status: 503 });
  }
  if (!currentUser || currentUser.walletBalance < denomination.priceNgn) {
    return Response.json({ ok: false, error: "Insufficient wallet balance." }, { status: 402 });
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
    if (error?.message === "REPLAY_RACED" || error?.code === "23505" || error?.cause?.code === "23505") {
      const [replayed] = await db.select().from(orders)
        .where(and(eq(orders.userId, user.id), eq(orders.requestId, requestId))).limit(1);
      if (replayed) return replay(replayed);
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
  let providerCallStarted = false;

  try {
    const foxreloadItemId = await resolveFoxreloadProductId({
      brand: card.name,
      amountUsd: denomination.amountUsd,
      preferredId: denomination.foxreloadProductId || denomination.id,
    });

    // Serialize the provider boundary with account suspension. The lock cannot
    // undo a call already started, but suspension that wins first blocks it.
    await db.transaction(async (tx) => {
      const [account] = await tx.select({ suspendedAt: users.suspendedAt, deletedAt: users.deletedAt }).from(users)
        .where(eq(users.id, user.id)).for("update").limit(1);
      if (!account || account.suspendedAt || account.deletedAt) throw new Error("Account unavailable");
      const [started] = await tx.update(orders).set({ status: "review", reconciliationNote: "Provider order creation started; outcome requires reconciliation." })
        .where(and(eq(orders.id, orderId), eq(orders.status, "processing"))).returning({ id: orders.id });
      if (!started) throw new Error("Purchase claim unavailable");
    });
    providerCallStarted = true;
    const upstreamOrder = await createFoxreloadOrder({
      itemId: foxreloadItemId,
      quantity: 1,
      idempotencyKey: requestId,
    });
    providerOrderId = upstreamOrder.id;
    if (!providerOrderId) throw new Error("Provider did not return an order reference");
    // Persist the provider identifier before any call that can spend.
    const [recorded] = await db.update(orders).set({ providerRequestId: providerOrderId, reconciliationNote: "Provider order created; payment and delivery require reconciliation." })
      .where(and(eq(orders.id, orderId), eq(orders.status, "review"))).returning({ id: orders.id });
    if (!recorded) throw new Error("Purchase claim unavailable");

    await payFoxreloadOrder(upstreamOrder.id);
    const codes = await pollFoxreloadOrderCodes(upstreamOrder.id);
    voucherCode = codes[0] || "";

    if (!voucherCode) {
      throw new FoxreloadError("No voucher code received from provider", 502, "NO_CODE");
    }

    // Step 3: Mark order delivered with code
    const [delivered] = await db
      .update(orders)
      .set({
        status: "delivered",
        providerRequestId: providerOrderId,
        referenceCode: voucherCode,
        reconciliationNote: null,
      })
      .where(and(eq(orders.id, orderId), eq(orders.status, "review"))).returning({ id: orders.id });
    if (!delivered) throw new Error("Purchase claim unavailable");
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
  } catch (err: any) {
    if (providerCallStarted) {
      // A commit response can be lost after the code was saved. Re-read rather
      // than turning an already delivered order back into review.
      try {
        const [saved] = await db.select().from(orders).where(and(eq(orders.userId, user.id), eq(orders.requestId, requestId))).limit(1);
        if (saved?.status === "delivered" && saved.referenceCode) return replay(saved);
      } catch { /* keep the original uncertain outcome */ }
      // Once a provider request starts, neither a timeout nor a failed status
      // read proves that it did not create or pay for a voucher. Keep the debit
      // and order together for a human to reconcile; never auto-refund or retry.
      try {
        await db.update(orders).set({ status: "review", providerRequestId: providerOrderId || null,
          ...(voucherCode ? { referenceCode: voucherCode } : {}),
          reconciliationNote: "Provider outcome is uncertain; reconcile before refund or retry." })
          .where(and(eq(orders.id, orderId), eq(orders.status, "review")));
      } catch { console.error("Could not update gift card reconciliation status", { orderId }); }
      return Response.json({ ok: false, pending: true, reference,
        error: "The purchase outcome needs review. Your wallet was charged; contact support with the reference before trying again." }, { status: 502 });
    }
    console.error("Gift card preflight failed before provider purchase", { orderId });
    // Step 4: Reverse wallet debit and mark order as refunded
    const errorMessage =
      err instanceof FoxreloadError
        ? err.message
        : "Fulfillment provider unavailable";

    let refunded = false;
    try {
      // One transaction, like the debit above: money moving back and the order
      // saying it moved are one event. Crediting first and writing the status
      // after left a refund the wallet had and the order did not, and the
      // "debit still stands" note below was then the opposite of the truth.
      await db.transaction(async (tx) => {
        const [claimed] = await tx.update(orders).set({
          status: "refunded", refundedAt: new Date(), providerRequestId: providerOrderId || null,
          reconciliationNote: "Provider purchase was not started; preflight failed.",
        }).where(and(eq(orders.id, orderId), inArray(orders.status, ["processing", "review"]), isNull(orders.refundedAt)))
          .returning({ id: orders.id });
        if (!claimed) throw new Error("Gift card refund claim unavailable");
        await creditWalletInTx(tx, {
          userId: user.id,
          amount: denomination.priceNgn,
          type: "refund",
          description: `Refund · ${card.name} ($${denomination.amountUsd})`,
          orderId,
          reference: makeReference("RFB"),
        });
      });
      // The refund committed inside the transaction above, so `creditWallet`'s
      // usual nudge never ran. Without this the receipt waits for the nightly backstop.
      scheduleWalletEmails();
      refunded = true;
    } catch (refundErr) {
      // The debit stands and no card exists. `review` puts the row in front of an
      // operator on /admin/reconciliation, which is where a refund that no code
      // could complete belongs.
      console.error("Critical: Failed to auto-refund gift card order", refundErr);
      try {
        await db
          .update(orders)
          .set({
            status: "review",
            providerRequestId: providerOrderId || null,
            reconciliationNote: `Fulfillment failed: ${errorMessage}; automatic refund failed — debit still stands`.slice(0, 480),
          })
          .where(and(eq(orders.id, orderId), eq(orders.status, "processing")));
      } catch (noteError) {
        console.error("Critical: could not flag gift card order for review", noteError);
      }
    }

    return Response.json(
      {
        ok: false,
        error: refunded
          ? `Gift card fulfillment failed: ${errorMessage}. Your wallet has been refunded.`
          : `Gift card delivery could not be confirmed. We could not return the money automatically; contact support with reference ${reference}.`,
      },
      { status: err instanceof FoxreloadError && err.status >= 400 && err.status < 600 ? err.status : 502 },
    );
  }
}
