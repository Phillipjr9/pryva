import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { orders, users } from "@/db/schema";
import { beginPurchase } from "@/lib/checkout/purchase";
import { creditWalletInTx, debitWalletInTx, InsufficientFundsError, makeReference } from "@/lib/payments/wallet";
import {
  buyFleexaData,
  isFleexaConfigured,
} from "@/lib/providers/fleexa";
import { findPlan } from "@/lib/services/catalog";
import { priceFromCost } from "@/lib/services/pricing";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Resolve a data plan's selling price from the catalogue, and an estimated
 * wholesale cost for margin guarding.
 */
function dataPlanBySlug(slug: string): { price: number; costNgn: number } | null {
  const plan = findPlan(slug);
  if (!plan || plan.service !== "data") return null;
  const quote = priceFromCost(plan.price / 1.32, { service: "data" });
  return { price: plan.price, costNgn: quote.costNgn };
}

/**
 * POST /api/airtime/purchase
 *
 * Buys mobile data from Fleexa. The wallet is debited and the order is
 * recorded first (status `processing`), then Fleexa is called exactly once.
 * If Fleexa refuses, the debit is reversed and the order is marked refunded.
 */
export async function POST(request: Request) {
  const begun = await beginPurchase<Record<string, unknown>>(request, {
    bucket: "data-create",
    maxBodyBytes: 2_048,
    supplierGate: { open: isFleexaConfigured, message: "Data fulfilment is not configured yet." },
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

  const priced = dataPlanBySlug(planSlug);
  if (!priced) {
    return NextResponse.json({ ok: false, error: "That data plan is no longer available." }, { status: 400 });
  }

  if (user.walletBalance < priced.price) {
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

  const phoneNumber =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { phoneNumber?: unknown }).phoneNumber
      : null;
  if (typeof phoneNumber !== "string" || !phoneNumber) {
    return NextResponse.json({ ok: false, error: "A phone number is required." }, { status: 400 });
  }

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
        service: "data",
        productSlug: planSlug,
        productName: `Data plan · ${planSlug}`,
        planLabel: `Data bundle · ${planSlug}`,
        region: "Nigeria",
        duration: "30 days",
        amount: priced.price,
        status: "processing",
        provider: "fleexa",
        providerCostNgn: priced.costNgn,
        targetLink: phoneNumber,
      });

      return debitWalletInTx(tx, {
        userId: user.id,
        amount: priced.price,
        type: "debit",
        description: `Data plan · ${planSlug}`,
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

  let fulfilled;
  try {
    fulfilled = await buyFleexaData({ planId: planSlug, phoneNumber });
  } catch (error) {
    try {
      await db.transaction(async (tx: any) => {
        const [claimable] = await tx
          .update(orders)
          .set({ status: "refunded", refundedAt: new Date() })
          .where(and(eq(orders.id, orderId), eq(orders.status, "processing")))
          .returning({ id: orders.id });
        if (!claimable) throw new Error("Data order was already settled");

        await creditWalletInTx(tx, {
          userId: user.id,
          amount: priced.price,
          type: "refund",
          description: `Refund · Data plan · ${planSlug}`,
          orderId,
          reference: makeReference("RFB"),
        });
      });
    } catch (refundError) {
      console.error("Data refund failed", refundError);
      await db
        .update(orders)
        .set({ reconciliationNote: "Supplier refused; automatic refund failed" })
        .where(eq(orders.id, orderId));
    }
    return NextResponse.json(
      { ok: false, error: "We couldn't deliver that data bundle, so nothing was charged. Please try again." },
      { status: 502 },
    );
  }

  await db
    .update(orders)
    .set({
      status: "active",
      providerRequestId: fulfilled.requestId,
      referenceCode: fulfilled.phoneNumber,
      expiresAt: fulfilled.expiresAt ? new Date(fulfilled.expiresAt) : null,
    })
    .where(eq(orders.id, orderId));

  return NextResponse.json({
    ok: true,
    balance,
    replayed: false,
    order: {
      id: orderId,
      reference,
      productName: `Data plan · ${planSlug}`,
      planLabel: `Data bundle · ${planSlug}`,
      service: "data",
      amount: priced.price,
    },
    provider: "fleexa",
  });
}
