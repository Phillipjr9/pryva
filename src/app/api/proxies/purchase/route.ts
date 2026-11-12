import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { orders, proxySlots } from "@/db/schema";
import { beginPurchase, afterPurchase } from "@/lib/checkout/purchase";
import { isFleexaConfigured, getFleexaProxyCatalogue, buyFleexaProxy, FleexaError } from "@/lib/providers/fleexa";
import { priceFromCost } from "@/lib/services/pricing";
import { creditWalletInTx, debitWalletInTx, InsufficientFundsError, makeReference } from "@/lib/payments/wallet";
import { scheduleWalletEmails } from "@/lib/email/schedule-wallet-emails";
import { logger } from "@/lib/platform/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function intentHash(userId: string, values: unknown): string {
  return `proxy:${createHash("sha256").update(JSON.stringify([userId, values])).digest("hex")}`;
}

async function orderReceipt(userId: string, requestId: string, expectedIntent: string, replayed: boolean) {
  const [order] = await db.select().from(orders).where(and(eq(orders.userId, userId), eq(orders.requestId, requestId))).limit(1);
  if (!order) return null;
  if (order.requestIntent !== expectedIntent) return NextResponse.json({ ok: false, error: "This request ID belongs to another purchase." }, { status: 409 });
  const slots = await db.select({ id: proxySlots.id, country: proxySlots.country, state: proxySlots.state, status: proxySlots.status, expiresAt: proxySlots.expiresAt })
    .from(proxySlots).where(eq(proxySlots.orderId, order.id));
  return NextResponse.json({ ok: true, replayed, order: { id: order.id, reference: order.reference, status: order.status, amount: order.amount, slots } }, { status: order.status === "review" || order.status === "processing" ? 202 : 200, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const begun = await beginPurchase<Record<string, unknown>>(request, {
    bucket: "proxy-purchase", maxBodyBytes: 2048,
    supplierGate: { open: isFleexaConfigured, message: "Proxy ordering is not connected." },
  });
  if (!begun.ok) return begun.response;
  const { user, body } = begun;
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ ok: false, error: "Invalid purchase request." }, { status: 400 });
  const { planId, country, state, proxyType, requestId, expectedPriceNgn } = body;
  if (Object.keys(body).some((key) => !["planId", "country", "state", "proxyType", "requestId", "expectedPriceNgn"].includes(key)) ||
      typeof planId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(planId) || typeof country !== "string" || !/^[A-Z]{2}$/.test(country) ||
      (state !== undefined && (typeof state !== "string" || state.length > 100 || /[\u0000-\u001f\u007f]/.test(state))) ||
      (proxyType !== 2 && proxyType !== 3) || typeof requestId !== "string" || !UUID.test(requestId) ||
      !Number.isSafeInteger(expectedPriceNgn) || (expectedPriceNgn as number) < 1 || (expectedPriceNgn as number) > 2_147_483_647) {
    return NextResponse.json({ ok: false, error: "Invalid purchase request." }, { status: 400 });
  }
  const normalizedRequestId = requestId.toLowerCase();
  const normalizedState = (state as string | undefined)?.trim() || "Random";
  const intent = intentHash(user.id, { planId, country, state: normalizedState, proxyType, expectedPriceNgn });
  const existing = await orderReceipt(user.id, normalizedRequestId, intent, true);
  if (existing) return existing;

  let catalogue;
  try { catalogue = await getFleexaProxyCatalogue(); }
  catch { return NextResponse.json({ ok: false, error: "Could not verify current proxy availability." }, { status: 503 }); }
  const plan = catalogue.plans.find((item) => item.id === planId);
  const destination = catalogue.countries.find((item) => item.code === country);
  const retail = plan ? priceFromCost(plan.priceNgn, { service: "proxies" }).priceNgn : null;
  if (!catalogue.status.enabled || !plan || !destination || retail === null || !destination.states.includes(normalizedState) || retail !== expectedPriceNgn) {
    return NextResponse.json({ ok: false, error: "Plan, destination, or price changed. Refresh the proxy catalogue." }, { status: 409 });
  }
  const id = randomUUID();
  const reference = makeReference("PRX");
  try {
    await db.transaction(async (tx) => {
      const [raced] = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.userId, user.id), eq(orders.requestId, normalizedRequestId))).limit(1);
      if (raced) throw new Error("REQUEST_ALREADY_CLAIMED");
      await tx.insert(orders).values({
        id, reference, userId: user.id, requestId: normalizedRequestId, requestIntent: intent,
        service: "proxies", productSlug: plan.id, productName: `Residential proxy · ${plan.label}`,
        planLabel: `${plan.quantity} IP slot(s) · ${destination.name}`, region: destination.name,
        duration: `Up to ${catalogue.status.expiryHours} hours`, amount: retail, status: "processing", provider: "fleexa",
        reconciliationNote: "Proxy purchase reserved; supplier submission requires reconciliation.",
      });
      await debitWalletInTx(tx, { userId: user.id, amount: retail, type: "debit", description: `Residential proxy · ${plan.label}`, orderId: id, reference });
    });
  } catch (error) {
    if (error instanceof InsufficientFundsError) return NextResponse.json({ ok: false, error: "Insufficient wallet balance." }, { status: 402 });
    const raced = await orderReceipt(user.id, normalizedRequestId, intent, true);
    if (raced) return raced;
    return NextResponse.json({ ok: false, error: "Could not confirm the purchase reservation. Check Orders and Wallet before retrying." }, { status: 503 });
  }
  scheduleWalletEmails();

  try {
    const result = await buyFleexaProxy({ planId: plan.id, country, state: normalizedState, proxyType, idempotencyKey: id });
    const rows = result.slots;
    const validReceipt = result.currency === "NGN" && result.amountPaid === plan.priceNgn && rows.length === plan.quantity && rows.every((slot) => slot.country === country && slot.currency === "NGN");
    await db.transaction(async (tx) => {
      if (rows.length) await tx.insert(proxySlots).values(rows.map((slot) => ({
        orderId: id, providerSlotId: slot.id, country: slot.country, state: normalizedState,
        proxyType, status: slot.status, expiresAt: slot.expiresAt ? new Date(slot.expiresAt) : null,
      }))).onConflictDoNothing({ target: proxySlots.providerSlotId });
      await tx.update(orders).set({
        status: validReceipt ? "active" : "review", providerRequestId: result.transactionId,
        providerCostNgn: result.amountPaid,
        reconciliationNote: validReceipt ? "Proxy purchased; each slot must be extracted before credentials are available." : "Supplier receipt did not match the live quote; reconcile before further purchase or refund.",
      }).where(and(eq(orders.id, id), eq(orders.status, "processing"), isNull(orders.refundedAt)));
    });
  } catch (error) {
    // The provider accepts an idempotency key, but an exception can still mean
    // the remote order succeeded and its response was lost. Keep the debit and
    // mark for review; never repeat or refund an ambiguous call automatically.
    if (error instanceof FleexaError && error.code === "INSUFFICIENT_BALANCE") {
      try {
        await db.transaction(async (tx) => {
          const [refunded] = await tx.update(orders).set({ status: "refunded", refundedAt: new Date(), reconciliationNote: "Fleexa definitively refused the proxy order for insufficient supplier balance." })
            .where(and(eq(orders.id, id), eq(orders.status, "processing"), isNull(orders.refundedAt))).returning({ id: orders.id });
          if (refunded) await creditWalletInTx(tx, { userId: user.id, amount: retail, type: "refund", description: "Proxy order refused by supplier", orderId: id, reference: makeReference("RFB") });
        });
      } catch { /* keep the original order for manual reconciliation */ }
    } else {
      await db.update(orders).set({ status: "review", reconciliationNote: "Supplier outcome uncertain; check provider order before refund or retry." })
        .where(and(eq(orders.id, id), eq(orders.status, "processing"), isNull(orders.refundedAt))).catch(() => {});
    }
    logger.warn("Fleexa proxy purchase requires reconciliation", { orderId: id, reason: error instanceof FleexaError ? error.code : "unknown" });
  }
  await afterPurchase(user.id);
  return (await orderReceipt(user.id, normalizedRequestId, intent, false)) ?? NextResponse.json({ ok: false, error: "Order could not be confirmed. Check your orders before retrying." }, { status: 503 });
}
