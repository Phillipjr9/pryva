import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { orders, users, type Order } from "@/db/schema";
import { afterPurchase, beginPurchase } from "@/lib/checkout/purchase";
import { creditWalletInTx, debitWalletInTx, InsufficientFundsError, makeReference } from "@/lib/payments/wallet";
import {
  buyFleexaProxy,
  isFleexaConfigured,
  listFleexaProxyPlans,
  type FleexaProxyPlan,
} from "@/lib/providers/fleexa";
import { findPlan } from "@/lib/services/catalog";
import { priceFromCost } from "@/lib/services/pricing";
import { deliveryWindowMs } from "@/lib/services/registry";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Proxy plans from the catalogue, keyed by slug so the purchase route can
 * resolve a selling price without calling the supplier first.
 */
function proxyPlanBySlug(slug: string): { plan: { price: number; service: string }; costNgn: number } | null {
  const plan = findPlan(slug);
  if (!plan || plan.service !== "proxies") return null;
  // The catalogue price already includes markup; reverse it from the target
  // markup band to estimate the wholesale cost for margin guarding.
  const quote = priceFromCost(plan.price / 1.35, { service: "proxies" });
  return { plan: { price: plan.price, service: plan.service }, costNgn: quote.costNgn };
}

/**
 * POST /api/proxies/purchase
 *
 * Buys proxy bandwidth from Fleexa. The wallet is debited and the order is
 * recorded first (status `processing`), then Fleexa is called exactly once.
 * If Fleexa refuses, the debit is reversed and the order is marked refunded —
 * the customer is never out of pocket for a delivery that never started.
 */
export async function POST(request: Request) {
  const begun = await beginPurchase<Record<string, unknown>>(request, {
    bucket: "proxy-create",
    maxBodyBytes: 2_048,
    supplierGate: { open: isFleexaConfigured, message: "Proxy fulfilment is not configured yet." },
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

  const priced = proxyPlanBySlug(planSlug);
  if (!priced) {
    return NextResponse.json({ ok: false, error: "That proxy plan is no longer available." }, { status: 400 });
  }

  if (user.walletBalance < priced.plan.price) {
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
        service: "proxies",
        productSlug: planSlug,
        productName: `Proxy plan · ${planSlug}`,
        planLabel: `Proxy bandwidth · ${planSlug}`,
        region: "Not country-specific",
        duration: "7 days to use",
        amount: priced.plan.price,
        status: "processing",
        provider: "fleexa",
        providerCostNgn: priced.costNgn,
      });

      return debitWalletInTx(tx, {
        userId: user.id,
        amount: priced.plan.price,
        type: "debit",
        description: `Proxy plan · ${planSlug}`,
        orderId,
        reference,
      });
    });
  } catch (error) {
    if (error instanceof InsufficientFundsError) {
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
    throw error;
  }

  // Call Fleexa exactly once. Never retried: a second call is a second order.
  let fulfilled;
  try {
    fulfilled = await buyFleexaProxy({ planId: planSlug });
  } catch (error) {
    // The supplier refused: give the money back and mark the order refunded.
    try {
      await db.transaction(async (tx: any) => {
        const [claimable] = await tx
          .update(orders)
          .set({ status: "refunded", refundedAt: new Date() })
          .where(and(eq(orders.id, orderId), eq(orders.status, "processing")))
          .returning({ id: orders.id });
        if (!claimable) throw new Error("Proxy order was already settled");

        await creditWalletInTx(tx, {
          userId: user.id,
          amount: priced.plan.price,
          type: "refund",
          description: `Refund · Proxy plan · ${planSlug}`,
          orderId,
          reference: makeReference("RFB"),
        });
      });
    } catch (refundError) {
      console.error("Proxy refund failed", refundError);
      await db
        .update(orders)
        .set({ reconciliationNote: "Supplier refused; automatic refund failed" })
        .where(eq(orders.id, orderId));
    }
    return NextResponse.json(
      { ok: false, error: "We couldn't start that proxy plan, so nothing was charged. Please try again." },
      { status: 502 },
    );
  }

  await db
    .update(orders)
    .set({
      status: "active",
      providerRequestId: fulfilled.requestId,
      referenceCode: fulfilled.credentials ? JSON.stringify(fulfilled.credentials) : null,
      expiresAt: fulfilled.expiresAt ? new Date(fulfilled.expiresAt) : null,
    })
    .where(eq(orders.id, orderId));

  void afterPurchase(user.id);

  return NextResponse.json({
    ok: true,
    balance,
    replayed: false,
    order: {
      id: orderId,
      reference,
      productName: `Proxy plan · ${planSlug}`,
      planLabel: `Proxy bandwidth · ${planSlug}`,
      service: "proxies",
      amount: priced.plan.price,
    },
    provider: "fleexa",
  });
}
