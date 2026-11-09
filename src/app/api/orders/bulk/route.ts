import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { bulkBatches, orders, users } from "@/db/schema";
import { beginPurchase, afterPurchase } from "@/lib/checkout/purchase";
import { findPlan } from "@/lib/services/catalog";
import { calculateBulkOrder, expandBulkOrder, MAX_BULK_UNITS, type BulkOrderItem } from "@/lib/services/bulk-orders";
import { fulfilmentIntent, fulfillPlan } from "@/lib/services/fulfillment";
import { isNumberPlanOrderingConfigured } from "@/lib/services/numbers/number-availability";
import { creditWalletInTx, debitWalletInTx, InsufficientFundsError, makeReference } from "@/lib/payments/wallet";
import { scheduleWalletEmails } from "@/lib/email/schedule-wallet-emails";
import { ORDER_PROVIDERS } from "@/lib/services/order-providers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** An interrupted batch is never resumed automatically: each supplier call is
 * non-idempotent and a missing response does not prove it did not happen. */
export async function POST(request: Request) {
  const begun = await beginPurchase<{ requestId?: unknown; items?: unknown }>(request, { bucket: "bulk-create", maxBodyBytes: 4096 });
  if (!begun.ok) return begun.response;
  const { user, body } = begun;
  if (!body || typeof body !== "object" || typeof body.requestId !== "string" || !UUID.test(body.requestId) || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > MAX_BULK_UNITS) {
    return Response.json({ ok: false, error: "Invalid batch request." }, { status: 400 });
  }
  const items: BulkOrderItem[] = [];
  const seen = new Set<string>();
  let count = 0;
  for (const value of body.items) {
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.productSlug !== "string" || value.productSlug.length > 80 || !Number.isSafeInteger(value.quantity) || value.quantity < 1 || seen.has(value.productSlug)) {
      return Response.json({ ok: false, error: "Invalid batch item." }, { status: 400 });
    }
    seen.add(value.productSlug);
    count += value.quantity;
    if (count > MAX_BULK_UNITS) return Response.json({ ok: false, error: `A batch may contain at most ${MAX_BULK_UNITS} units.` }, { status: 400 });
    items.push({ productSlug: value.productSlug, quantity: value.quantity });
  }
  items.sort((a, b) => a.productSlug.localeCompare(b.productSlug));
  const requestId = body.requestId.toLowerCase();
  const intentHash = createHash("sha256").update(JSON.stringify(items)).digest("hex");
  const [existing] = await db.select().from(bulkBatches).where(and(eq(bulkBatches.userId, user.id), eq(bulkBatches.requestId, requestId))).limit(1);
  const receipt = async (batch: typeof bulkBatches.$inferSelect, replayed: boolean) => {
    if (batch.intentHash !== intentHash) return Response.json({ ok: false, error: "This request ID belongs to a different batch. Check your orders." }, { status: 409 });
    const units = await db.select({ id: orders.id, reference: orders.reference, status: orders.status, amount: orders.amount })
      .from(orders).where(and(eq(orders.userId, user.id), eq(orders.requestIntent, `bulk:${batch.id}`)));
    // A worker may stop after its last unit, or an operator may later settle a
    // reviewed unit. Closing a batch is safe only when every claimed unit is
    // present and terminal; this never starts a provider call or moves money.
    const terminal = new Set(["active", "delivered", "expired", "refunded", "cancelled"]);
    let status = batch.status;
    if (status !== "completed" && units.length === batch.unitCount && units.every((unit) => terminal.has(unit.status))) {
      const [closed] = await db.update(bulkBatches).set({ status: "completed" }).where(and(eq(bulkBatches.id, batch.id), eq(bulkBatches.status, status))).returning({ status: bulkBatches.status });
      if (closed) status = closed.status;
    }
    return Response.json({ ok: true, replayed, pending: status !== "completed", batch: { id: batch.id, status, total: batch.total, count: batch.unitCount }, units,
      message: status !== "completed" ? "This batch needs review. Check your orders and wallet before trying again." : "Batch processed. Check each order for its status." }, { status: status === "completed" ? 200 : 202 });
  };
  if (existing) return receipt(existing, true);
  for (const item of items) {
    const plan = findPlan(item.productSlug);
    if (!plan || plan.service !== "numbers" || !fulfilmentIntent(plan.slug) || !isNumberPlanOrderingConfigured(plan.slug)) {
      return Response.json({ ok: false, error: "A plan could not be confirmed. Check your orders and wallet before retrying." }, { status: 503 });
    }
  }
  const basket = calculateBulkOrder(items);
  const units = expandBulkOrder(basket);
  const id = randomUUID();
  let claimed: { orderId: string; planSlug: string; amount: number }[];
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${user.id}))`);
      const [raced] = await tx.select().from(bulkBatches).where(and(eq(bulkBatches.userId, user.id), eq(bulkBatches.requestId, requestId))).limit(1);
      if (raced) return { raced };
      const [unresolved] = await tx.select().from(bulkBatches).where(and(eq(bulkBatches.userId, user.id), or(eq(bulkBatches.status, "processing"), eq(bulkBatches.status, "review")))).limit(1);
      if (unresolved) return { unresolved };
      const [batch] = await tx.insert(bulkBatches).values({ id, userId: user.id, requestId, intentHash, total: basket.total, unitCount: units.length, status: "processing" }).returning();
      const rows: { orderId: string; planSlug: string; amount: number }[] = [];
      for (const unit of units) {
        const plan = findPlan(unit.productSlug)!;
        const intent = fulfilmentIntent(plan.slug)!;
        const orderId = randomUUID(), reference = makeReference("PRY");
        await tx.insert(orders).values({ id: orderId, reference, userId: user.id, requestId: randomUUID(), requestIntent: `bulk:${id}`, service: "numbers", productSlug: plan.slug, productName: plan.name, planLabel: plan.planLabel, region: plan.region, duration: plan.duration, amount: unit.amount, status: "processing", provider: intent.kind === "sms" ? ORDER_PROVIDERS.bitcall : ORDER_PROVIDERS.fleexa, reconciliationNote: "Bulk unit reserved; provider not yet contacted." });
        await debitWalletInTx(tx, { userId: user.id, amount: unit.amount, type: "debit", description: `Bulk purchase: ${plan.name}`, orderId, reference });
        rows.push({ orderId, planSlug: plan.slug, amount: unit.amount });
      }
      return { batch, rows };
    });
    if (result.raced) return receipt(result.raced, true);
    if (result.unresolved) return Response.json({ ok: true, pending: true, batch: { id: result.unresolved.id, status: result.unresolved.status }, message: "An earlier batch needs review. Check your orders and wallet before placing another." }, { status: 202 });
    claimed = result.rows!;
  } catch (error) {
    if (error instanceof InsufficientFundsError) return Response.json({ ok: false, error: "Insufficient wallet balance. Check your orders before retrying." }, { status: 402 });
    // A lost commit response can mean the reservation succeeded. Never suggest a fresh key.
    return Response.json({ ok: false, error: "Could not confirm the batch. Check your orders and wallet before retrying this request." }, { status: 500 });
  }
  scheduleWalletEmails();
  let deliveredAny = false;
  let stopped = false;
  let needsReview = false;
  for (const unit of claimed) {
    let started = false;
    const plan = findPlan(unit.planSlug)!;
    try {
      if (stopped) throw new Error("Batch stopped before provider call");
      const markAttempt = async () => {
        await db.transaction(async (tx) => {
          const [account] = await tx.select({ suspendedAt: users.suspendedAt, deletedAt: users.deletedAt }).from(users).where(eq(users.id, user.id)).for("update").limit(1);
          if (!account || account.suspendedAt || account.deletedAt) throw new Error("Account unavailable");
          const [claimedUnit] = await tx.update(orders).set({ reconciliationNote: "Bulk provider purchase started; outcome requires tracking." }).where(and(eq(orders.id, unit.orderId), eq(orders.status, "processing"), isNull(orders.refundedAt))).returning({ id: orders.id });
          if (!claimedUnit) throw new Error("Unit claim unavailable");
        });
        started = true;
      };
      const accepted = async (providerRequestId: string) => {
        const [saved] = await db.update(orders).set({ providerRequestId, reconciliationNote: "Provider accepted bulk unit; delivery requires tracking." }).where(and(eq(orders.id, unit.orderId), eq(orders.status, "processing"), isNull(orders.refundedAt))).returning({ id: orders.id });
        if (!saved) throw new Error("Could not record supplier reference");
      };
      // Margin checks use the allocated discounted price, not the full-price plan.
      const fulfilled = await fulfillPlan({ ...plan, price: unit.amount }, { onOtpAttempt: markAttempt, onOtpAccepted: accepted, onRentalAttempt: markAttempt, onRentalAccepted: accepted });
      const [saved] = await db.update(orders).set({ status: "active", provider: fulfilled.provider, providerRequestId: fulfilled.providerRequestId, providerCostNgn: fulfilled.providerCostNgn, referenceCode: fulfilled.referenceCode, otpCode: fulfilled.otpCode, expiresAt: fulfilled.expiresAt, reconciliationNote: null }).where(and(eq(orders.id, unit.orderId), eq(orders.status, "processing"), isNull(orders.refundedAt))).returning({ id: orders.id });
      if (!saved) throw new Error("Unit delivery could not be saved");
      deliveredAny = true;
    } catch {
      stopped = true;
      if (started) {
        needsReview = true;
        await db.update(orders).set({ status: "review", reconciliationNote: "Bulk supplier outcome needs reconciliation; do not retry or refund without checking." }).where(and(eq(orders.id, unit.orderId), eq(orders.status, "processing"), isNull(orders.refundedAt)));
      } else {
        // No paid supplier call started for this unit. Its exact linked debit is
        // reversed atomically; unattempted later units take the same path.
        try {
          await db.transaction(async (tx) => {
            const [refunded] = await tx.update(orders).set({ status: "refunded", refundedAt: new Date(), reconciliationNote: "Supplier not contacted; reserved unit refunded." }).where(and(eq(orders.id, unit.orderId), eq(orders.status, "processing"), isNull(orders.refundedAt))).returning({ id: orders.id });
            if (!refunded) throw new Error("Unit not refundable");
            await creditWalletInTx(tx, { userId: user.id, amount: unit.amount, type: "refund", description: `Bulk unit refund: ${plan.name}`, orderId: unit.orderId, reference: makeReference("RFB") });
          });
        } catch { needsReview = true; }
      }
    }
  }
  if (deliveredAny) void afterPurchase(user.id);
  scheduleWalletEmails();
  const [batch] = await db.update(bulkBatches).set({ status: needsReview ? "review" : "completed" }).where(eq(bulkBatches.id, id)).returning();
  return receipt(batch, false);
}
