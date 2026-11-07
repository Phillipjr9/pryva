import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { orders, users, type Order } from "@/db/schema";
import { afterPurchase, beginPurchase } from "@/lib/checkout/purchase";
import { creditWalletInTx, debitWalletInTx, InsufficientFundsError, makeReference } from "@/lib/payments/wallet";
import { isFleexaConfigured } from "@/lib/providers/fleexa";
import { isBitcallConfigured } from "@/lib/providers/bitcall";
import { findPlan } from "@/lib/services/catalog";
import { fulfillPlan, cancelUpstream } from "@/lib/services/fulfillment";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST /api/numbers/purchase
 *
 * Buys a virtual number from whichever configured supplier can serve it.
 * The supplier is called first through `fulfillPlan`; only once the number is
 * in hand do we record the order and debit the wallet. If the debit then
 * fails, the upstream purchase is cancelled so the customer is never out of
 * pocket for a number we could not charge for.
 */
export async function POST(request: Request) {
  const begun = await beginPurchase<Record<string, unknown>>(request, {
    bucket: "number-create",
    maxBodyBytes: 2_048,
    supplierGate: {
      open: () => isFleexaConfigured() || isBitcallConfigured(),
      message: "Number fulfilment is not configured yet.",
    },
  });
  if (!begun.ok) return begun.response;
  const { user, body } = begun;

  const planSlug =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { planSlug?: unknown }).planSlug
      : null;
  if (typeof planSlug !== "string" || !planSlug || planSlug.length > 80) {
    return NextResponse.json({ ok: false, error: "Invalid plan." }, { status: 400 });
  }

  const plan = findPlan(planSlug);
  if (!plan || plan.service !== "numbers") {
    return NextResponse.json({ ok: false, error: "That number plan is no longer available." }, { status: 400 });
  }

  if (user.walletBalance < plan.price) {
    return NextResponse.json(
      { ok: false, error: "Your wallet balance is too low for this order." },
      { status: 402 },
    );
  }

  const rawRequestId =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { requestId?: unknown }).requestId
      : null;
  if (typeof rawRequestId !== "string" || !UUID.test(rawRequestId)) {
    return NextResponse.json({ ok: false, error: "Invalid purchase request. Please try again." }, { status: 400 });
  }
  const requestId = rawRequestId.toLowerCase();

  const [existing] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.userId, user.id), eq(orders.requestId, requestId)))
    .limit(1);
  if (existing) {
    return NextResponse.json({
      ok: true,
      balance: user.walletBalance,
      replayed: true,
      order: {
        id: existing.id,
        reference: existing.reference,
        productName: existing.productName,
        planLabel: existing.planLabel ?? undefined,
        service: existing.service,
        amount: existing.amount,
      },
    });
  }

  const reference = makeReference("PRY");
  const orderId = randomUUID();

  // Buy from the supplier before charging the wallet. If the supplier refuses,
  // nothing was debited and there is nothing to refund.
  let fulfilled;
  try {
    fulfilled = await fulfillPlan(plan);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "We couldn't deliver that number right now — nothing was charged.",
      },
      { status: 502 },
    );
  }

  let balance: number;
  try {
    balance = await db.transaction(async (tx: any) => {
      const [raced] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.userId, user.id), eq(orders.requestId, requestId)))
        .limit(1);
      if (raced) {
        return tx
          .select({ balance: users.walletBalance })
          .from(users)
          .where(eq(users.id, user.id))
          .limit(1)
          .then((rows: { balance: number }[]) => rows[0]?.balance ?? 0);
      }

      await tx.insert(orders).values({
        id: orderId,
        reference,
        userId: user.id,
        requestId,
        service: "numbers",
        productSlug: planSlug,
        productName: `${plan.name} number`,
        planLabel: plan.planLabel,
        region: plan.region,
        duration: plan.duration,
        amount: plan.price,
        status: "active",
        provider: fulfilled.provider,
        providerRequestId: fulfilled.providerRequestId ?? null,
        referenceCode: fulfilled.referenceCode ?? null,
        expiresAt: fulfilled.expiresAt ? new Date(fulfilled.expiresAt) : null,
      });

      return debitWalletInTx(tx, {
        userId: user.id,
        amount: plan.price,
        type: "debit",
        description: `${plan.name} · ${plan.planLabel}`.slice(0, 200),
        orderId,
        reference,
      });
    });
  } catch (error) {
    if (error instanceof InsufficientFundsError) {
      // The number was bought upstream; cancel it so the customer is not
      // out of pocket for a charge that never landed.
      try {
        await cancelUpstream({
          provider: fulfilled.provider,
          providerRequestId: fulfilled.providerRequestId ?? "",
          service: "numbers",
          duration: plan.duration,
        });
      } catch (cancelError) {
        console.error("Number refund after charge failure failed", cancelError);
      }
      return NextResponse.json(
        {
          ok: false,
          error: `Your wallet balance is ₦${error.balance.toLocaleString("en-NG")} — top up to continue.`,
          required: error.required,
          balance: error.balance,
        },
        { status: 402 },
      );
    }
    // The number was bought upstream but the database write failed. Reverse
    // upstream so the customer is not out of pocket.
    try {
      await cancelUpstream({
        provider: fulfilled.provider,
        providerRequestId: fulfilled.providerRequestId ?? "",
        service: "numbers",
        duration: plan.duration,
      });
    } catch (cancelError) {
      console.error("Number refund after write failure failed", cancelError);
    }
    throw error;
  }

  void afterPurchase(user.id);

  return NextResponse.json({
    ok: true,
    balance,
    replayed: false,
    order: {
      id: orderId,
      reference,
      productName: `${plan.name} number`,
      planLabel: plan.planLabel,
      service: "numbers",
      amount: plan.price,
      status: "active",
    },
    provider: fulfilled.provider,
  });
}
