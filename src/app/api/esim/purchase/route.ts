import { createHash, randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { afterPurchase, beginPurchase } from "@/lib/checkout/purchase";
import { orders, users, type Order } from "@/db/schema";
import { getCurrentUser } from "@/lib/identity/auth";
import { esimOfferTerms, findEsimOffer, recheckEsimOffer, type EsimOffer } from "@/lib/services/esim/esim-catalog";
import { purchaseEsim } from "@/lib/services/esim/esim-fulfilment";
import { MARGIN_BLOCKED_MESSAGE } from "@/lib/services/margin-guard";
import { ESIM_PROVIDER } from "@/lib/services/order-providers";
import { purchaseRateLimiter } from "@/lib/platform/rate-limit";
import { debitWalletInTx, InsufficientFundsError, makeReference } from "@/lib/payments/wallet";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function intentFor(offerId: string, price: unknown, terms: unknown): string | null {
  if (typeof price !== "number" || !Number.isSafeInteger(price) || price <= 0 ||
      typeof terms !== "string" || !/^[a-f0-9]{24}$/.test(terms)) return null;
  return `esim:v1:${createHash("sha256").update(JSON.stringify([offerId, price, terms])).digest("hex")}`;
}

function matchesRequest(order: Order, offerId: string, intent: string | null): boolean {
  if (order.service !== "esim" || order.productSlug !== offerId) return false;
  // Existing eSIM orders predate the intent fingerprint. They can still be
  // recovered by their exact plan and user; never start another purchase.
  return order.requestIntent == null || (intent !== null && order.requestIntent === intent);
}

function mismatch() {
  return Response.json({ ok: false, error: "This request belongs to a different order. Check your orders before trying again." }, { status: 409 });
}

function replay(order: Order, balance: number, offerId: string, intent: string | null) {
  if (!matchesRequest(order, offerId, intent)) return mismatch();
  if (order.status === "cancelled") {
    const refused = order.reconciliationNote === "Supplier refused the eSIM purchase; nothing was charged." ||
      order.reconciliationNote === "Account unavailable before supplier purchase; nothing was charged.";
    return Response.json({ ok: false, error: refused ? "This attempt was not completed. You can start a new purchase." : "This order was cancelled. Check your orders before trying again.", ...(refused ? { safeToRetry: true } : {}) }, { status: 409 });
  }
  return receipt(order, balance, true);
}

function receipt(order: Order, balance: number, replayed: boolean, extra: Record<string, unknown> = {}) {
  return Response.json({
    ok: true,
    balance,
    replayed,
    ...extra,
    order: {
      id: order.id,
      reference: order.reference,
      productName: order.productName,
      planLabel: order.planLabel,
      service: order.service,
      amount: order.amount,
      status: order.status,
    },
  });
}

/** Only the fields a plan needs. Truncation is explicit: the columns are shorter than provider text can be. */
function planShape(offer: EsimOffer) {
  return {
    slug: offer.id,
    name: offer.name.slice(0, 160),
    planLabel: `${offer.dataLabel} · ${offer.validityLabel}`.slice(0, 120),
    region: offer.region.slice(0, 80),
    duration: offer.validityLabel.slice(0, 80),
  };
}

async function findRequestOrder(userId: string, requestId: string): Promise<Order | null> {
  const [row] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.requestId, requestId)))
    .limit(1);
  return row ?? null;
}

async function currentBalance(userId: string): Promise<number> {
  const [row] = await db.select({ balance: users.walletBalance }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.balance ?? 0;
}

/**
 * Buy an eSIM plan.
 *
 * A unique order is claimed before any supplier call. A retry or concurrent
 * submit therefore cannot spend twice, even if the first call times out or the
 * process dies. A claim with an unknown outcome remains in review. Customer
 * money moves only once the activation material is in hand, so the outcomes are:
 *
 *   * **delivered** — record `active`, store the profile, debit once;
 *   * **provisioning** — record `processing`, charge nothing, and let the order
 *     page / nightly sweep finish it;
 *   * **unknown** — the supplier may have bought it, so nothing is retried and
 *     the order is parked on the review queue with no charge.
 */
export async function POST(request: Request) {
  const begun = await beginPurchase<Record<string, unknown>>(request, {
    bucket: "esim-create",
    maxBodyBytes: 2_048,
    copy: {
      // The preview refusal names the product: "purchases are unavailable" made
      // an operator checking eSIM think the whole wallet path was closed.
      unavailable: "eSIM ordering is unavailable in this environment.",
    },
  });
  if (!begun.ok) return begun.response;
  const { user, body } = begun;

  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  // Do not silently ignore a selected number (or any other unsupported option):
  // that could charge for a plan without honouring what the caller requested.
  if (Object.keys(record).some((key) => key !== "offerId" && key !== "requestId" && key !== "expectedPriceNgn" && key !== "expectedTerms" && key !== "recoveryOnly")) {
    return Response.json(
      { ok: false, error: "Additional purchase options are not supported. Check your orders before trying again." },
      { status: 400 },
    );
  }
  const offerId = typeof record.offerId === "string" ? record.offerId : null;
  if (!offerId || offerId.length > 64) {
    return Response.json({ ok: false, error: "Invalid plan." }, { status: 400 });
  }
  const rawRequestId = typeof record.requestId === "string" ? record.requestId : null;
  if (!rawRequestId || !UUID.test(rawRequestId)) {
    return Response.json({ ok: false, error: "Invalid purchase request. Please try again." }, { status: 400 });
  }
  const requestId = rawRequestId.toLowerCase();
  const requestIntent = intentFor(offerId, record.expectedPriceNgn, record.expectedTerms);

  try {
    // Replay first: a resubmit after a timeout must not buy a second profile.
    const already = await findRequestOrder(user.id, requestId);
    if (already) return replay(already, await currentBalance(user.id), offerId, requestIntent);
    if (record.recoveryOnly === true) {
      return Response.json({ ok: false, error: "This earlier attempt was not found. Contact support before starting another purchase." }, { status: 409 });
    }
    if (record.recoveryOnly !== undefined && record.recoveryOnly !== false) {
      return Response.json({ ok: false, error: "Invalid recovery request." }, { status: 400 });
    }

    // A customer must never be charged a different price from the one they saw.
    // Older clients may replay an existing request above, but cannot start a new
    // purchase until they reload and send the displayed whole-naira price.
    const expectedPriceNgn = record.expectedPriceNgn;
    const expectedTerms = record.expectedTerms;
    if (typeof expectedPriceNgn !== "number" || !Number.isSafeInteger(expectedPriceNgn) || expectedPriceNgn <= 0 ||
        typeof expectedTerms !== "string" || !/^[a-f0-9]{24}$/.test(expectedTerms)) {
      return Response.json({ ok: false, error: "Please reload the plan to confirm its current details and price." }, { status: 400 });
    }
    const listed = await findEsimOffer(offerId);
    if (!listed) return Response.json({ ok: false, error: "That eSIM plan is no longer available." }, { status: 400 });
    if (!listed.purchasable) return Response.json({ ok: false, error: MARGIN_BLOCKED_MESSAGE }, { status: 503 });
    // The catalog may be cached. Re-read the plan and recompute its price and
    // margin before spending provider funds; a read failure is not a buy signal.
    const offer = await recheckEsimOffer(listed).catch(() => null);
    if (!offer || !offer.purchasable) {
      return Response.json({ ok: false, error: "That plan cannot be confirmed right now. Nothing was charged." }, { status: 503 });
    }
    if (esimOfferTerms(offer) !== expectedTerms) {
      return Response.json({ ok: false, error: "The plan details changed. Reload this plan to review them before buying." }, { status: 409 });
    }
    if (offer.priceNgn !== expectedPriceNgn) {
      return Response.json({ ok: false, error: "The price changed. Reload this plan to review the new price before buying." }, { status: 409 });
    }

    if (user.walletBalance < offer.priceNgn) {
      return Response.json(
        {
          ok: false,
          error: `Your wallet balance is ₦${user.walletBalance.toLocaleString("en-NG")} — top up to continue.`,
          required: offer.priceNgn,
          balance: user.walletBalance,
        },
        { status: 402 },
      );
    }

    const reference = makeReference("PRY");
    const orderId = randomUUID();
    const shape = planShape(offer);
    // Claim this request *before* touching the supplier. The database's existing
    // (user_id, request_id) unique index makes concurrent retries safe across
    // application instances. Review is intentionally conservative: if the
    // process stops at any point, nobody is allowed to buy again automatically.
    const claimed = await db.insert(orders).values({
      id: orderId,
      reference,
      userId: user.id,
      requestId,
      requestIntent,
      service: "esim",
      productSlug: shape.slug,
      productName: shape.name,
      planLabel: shape.planLabel,
      region: shape.region,
      duration: shape.duration,
      amount: offer.priceNgn,
      status: "review",
      provider: ESIM_PROVIDER,
      // Retain the pre-purchase estimate for reconciliation, not as confirmed
      // supplier spending; realised-margin reporting excludes eSIM estimates.
      providerCostNgn: offer.costNgn,
      reconciliationNote: "eSIM purchase initiated; awaiting supplier outcome. Nothing has been charged.",
    }).onConflictDoNothing({ target: [orders.userId, orders.requestId] }).returning({ id: orders.id });
    if (claimed.length === 0) {
      const winner = await findRequestOrder(user.id, requestId);
      if (winner) return replay(winner, await currentBalance(user.id), offerId, requestIntent);
      return Response.json({ ok: false, error: "Check your orders before trying again." }, { status: 409 });
    }

    // Serialize the paid-provider boundary with suspension. Once this commits,
    // a suspension cannot cancel a supplier call that has already started.
    const eligible = await db.transaction(async (tx) => {
      const [account] = await tx.select({ suspendedAt: users.suspendedAt, deletedAt: users.deletedAt })
        .from(users).where(eq(users.id, user.id)).for("update").limit(1);
      if (!account || account.suspendedAt || account.deletedAt) {
        await tx.update(orders).set({ status: "cancelled", reconciliationNote: "Account unavailable before supplier purchase; nothing was charged." })
          .where(and(eq(orders.id, orderId), eq(orders.status, "review")));
        return false;
      }
      const [started] = await tx.update(orders).set({ reconciliationNote: "eSIM provider purchase started; outcome requires tracking. Nothing has been charged." })
        .where(and(eq(orders.id, orderId), eq(orders.status, "review"))).returning({ id: orders.id });
      if (!started) throw new Error("eSIM purchase claim unavailable");
      return true;
    });
    if (!eligible) return Response.json({ ok: false, error: "This account cannot start a purchase. Nothing was charged." }, { status: 403 });

    const outcome = await purchaseEsim(offer, async (providerOrderId) => {
      const [recorded] = await db.update(orders).set({
        providerRequestId: providerOrderId,
        reconciliationNote: "Supplier accepted the eSIM order; awaiting delivery. Nothing has been charged.",
      }).where(and(eq(orders.id, orderId), eq(orders.status, "review"))).returning({ id: orders.id });
      if (!recorded) throw new Error("eSIM order is no longer awaiting a supplier outcome");
    });
    if (outcome.kind === "refused") {
      const [cancelled] = await db.update(orders).set({
        status: "cancelled",
        reconciliationNote: "Supplier refused the eSIM purchase; nothing was charged.",
      }).where(and(eq(orders.id, orderId), eq(orders.status, "review"))).returning({ id: orders.id });
      if (!cancelled) throw new Error("eSIM order is no longer awaiting a supplier outcome");
      return Response.json(
        { ok: false, error: "We couldn't deliver that eSIM right now — nothing was charged. Reload the plan if you want to try again.", safeToRetry: true },
        { status: 502 },
      );
    }

    if (outcome.kind === "unknown") {
      const [reviewed] = await db.update(orders).set({
        reconciliationNote: "eSIM purchase outcome unknown at the supplier; nothing was charged.",
      }).where(and(eq(orders.id, orderId), eq(orders.status, "review"))).returning({ id: orders.id });
      if (!reviewed) throw new Error("eSIM order is no longer awaiting a supplier outcome");
      return Response.json(
        {
          ok: true,
          pending: true,
          balance: await currentBalance(user.id),
          order: { id: orderId, reference, productName: shape.name, planLabel: shape.planLabel, service: "esim", amount: offer.priceNgn, status: "review" },
          message: "We're reviewing this purchase. Nothing has been charged yet.",
        },
        { status: 202 },
      );
    }

    if (outcome.kind === "pending") {
      const [processing] = await db.update(orders).set({
        status: "processing",
        providerRequestId: outcome.providerRequestId,
        reconciliationNote: null,
      }).where(and(eq(orders.id, orderId), eq(orders.status, "review"))).returning({ id: orders.id });
      if (!processing) throw new Error("eSIM order is no longer awaiting a supplier outcome");
      return Response.json(
        {
          ok: true,
          pending: true,
          balance: await currentBalance(user.id),
          order: { id: orderId, reference, productName: shape.name, planLabel: shape.planLabel, service: "esim", amount: offer.priceNgn, status: "processing" },
          message: "Your eSIM is provisioning. It appears on this order as soon as it is ready, and you are only charged then.",
        },
        { status: 202 },
      );
    }

    const { delivery } = outcome;
    let balance: number;
    try {
      balance = await db.transaction(async (tx) => {
        const [activated] = await tx.update(orders).set({
          status: "active",
          provider: delivery.provider,
          providerRequestId: delivery.providerRequestId,
          referenceCode: delivery.iccid,
          esimIccid: delivery.iccid,
          esimActivationCode: delivery.activationCode,
          esimInstallUrl: delivery.installUrl,
          reconciliationNote: null,
        }).where(and(eq(orders.id, orderId), eq(orders.status, "review"))).returning({ id: orders.id });
        if (!activated) throw new Error("eSIM order is no longer awaiting activation");
        return debitWalletInTx(tx, {
          userId: user.id,
          amount: offer.priceNgn,
          type: "debit",
          description: `${shape.name} · ${shape.planLabel}`.slice(0, 200),
          orderId,
          reference,
        });
      });
    } catch (error) {
      // The profile exists upstream and we cannot refund it ourselves. The
      // transaction rolls back on failure; keep the claimed order for review and
      // retain the provider order reference for recovery, without exposing the
      // activation credential on an unpaid order.
      const insufficient = error instanceof InsufficientFundsError;
      await db.update(orders).set({
        status: "review",
        providerRequestId: delivery.providerRequestId,
        reconciliationNote: insufficient
          ? "eSIM delivered but the wallet no longer covered the price; nothing was charged."
          : "eSIM delivered but the charge outcome needs reconciliation.",
      }).where(and(eq(orders.id, orderId), eq(orders.status, "review")));
      // A generic transaction error can happen after a commit was sent; its
      // outcome is not necessarily known. Never claim the wallet was untouched.
      return Response.json(
        { ok: false, error: insufficient
          ? "The wallet no longer covers this order — nothing was charged. Contact support with your reference."
          : "We couldn't confirm the order. Check your orders or contact support before trying again." },
        { status: 409 },
      );
    }

    void afterPurchase(user.id);

    return Response.json({
      ok: true,
      balance,
      replayed: false,
      order: {
        id: orderId,
        reference,
        productName: shape.name,
        planLabel: shape.planLabel,
        service: "esim",
        amount: offer.priceNgn,
        status: "active",
      },
    });
  } catch {
    return Response.json({ ok: false, error: "We couldn't complete that order. Check your orders or contact support before trying again." }, { status: 500 });
  }
}
