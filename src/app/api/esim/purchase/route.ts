import { createHash, randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { afterPurchase, beginPurchase } from "@/lib/checkout/purchase";
import { orders, users, type Order } from "@/db/schema";
import { esimOfferTerms, findEsimOffer, recheckEsimOffer, type EsimOffer } from "@/lib/services/esim/esim-catalog";
import { purchaseEsim } from "@/lib/services/esim/esim-fulfilment";
import { MARGIN_BLOCKED_MESSAGE } from "@/lib/services/margin-guard";
import { ESIM_PROVIDER } from "@/lib/services/order-providers";
import { purchaseRateLimiter } from "@/lib/platform/rate-limit";
import {
  holdForReview,
  linkReservationToOrder,
  releaseReservation,
  reserveWallet,
  settleReservation,
} from "@/lib/payments/reservations";
import { makeReference } from "@/lib/payments/wallet";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * How long an eSIM hold stays "live" for the operator report: comfortably past
 * the supplier's full provisioning window (30 minutes), so a normal pending order
 * never looks like an abandoned hold. It is not a release timer — see
 * `expiredHolds`.
 */
const ESIM_HOLD_TTL_MS = 2 * 60 * 60 * 1000;

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
 * ## The order of operations is the safety property
 *
 *   1. replay check     — the request key already has an order? return it.
 *   2. re-quote         — the plan, price and terms are re-read and re-priced.
 *   3. **hold the money** — `reserveWallet` commits the price against the
 *      account's *available* funds in one atomic statement. Two concurrent
 *      submits, or a second tab, now contend on one row: only the ones the wallet
 *      can actually cover get a hold, and the rest are refused *before* any
 *      supplier is contacted. This replaced a bare `user.walletBalance < price`
 *      test, which two requests could both pass.
 *   4. claim the order  — still first-wins on `(user_id, request_id)`.
 *   5. call the supplier.
 *   6. settle / release / park, exactly once — settled only with the activation
 *      material in hand, released only on a definitive refusal, and parked for a
 *      human on anything ambiguous. Because step 3 committed the funds, step 6
 *      cannot be refused for want of money, an hour later if it has to be.
 *
 * The four outcomes:
 *
 *   * **delivered** — record `active`, store the profile, settle the hold;
 *   * **provisioning** — record `processing`, hold stays `held` and is settled
 *     when the profile arrives (page load or nightly sweep);
 *   * **refused** — cancel the order and release the hold, nothing spent;
 *   * **unknown** — the supplier may have bought it: nothing retried, nothing
 *     released, and the hold is parked as `review` for a human.
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

  // Both are assigned once the attempt gets far enough to own anything. The
  // outer catch uses them to leave an interrupted attempt in an honest state
  // rather than with a hold nobody will close.
  let reservationId: string | null = null;
  let supplierContacted = false;

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

    const shape = planShape(offer);

    // A fast, non-authoritative refusal for a wallet that plainly cannot cover
    // this plan. It is a courtesy: it costs no write and keeps a poor customer
    // from claiming an order row. It is *not* the spend guard — two requests can
    // both read the same balance here, which is exactly why the durable hold
    // below, not this line, is what authorises the supplier call.
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
    // Claim this request *before* touching the supplier. The database's existing
    // (user_id, request_id) unique index makes concurrent retries safe across
    // application instances. Review is intentionally conservative: if the
    // process stops at any point, nobody is allowed to buy again automatically.
    // Order first, hold second: the order row is what a replay reads, so a client
    // that resubmits gets its receipt rather than "still being checked".
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
      reconciliationNote: "eSIM purchase initiated; no supplier call has started and nothing has been charged.",
    }).onConflictDoNothing({ target: [orders.userId, orders.requestId] }).returning({ id: orders.id });
    if (claimed.length === 0) {
      const winner = await findRequestOrder(user.id, requestId);
      if (winner) return replay(winner, await currentBalance(user.id), offerId, requestIntent);
      return Response.json({ ok: false, error: "Check your orders before trying again." }, { status: 409 });
    }

    // Hold the money before anything that costs us anything. This is the
    // authoritative check: concurrent requests contend on the account row, so
    // only the ones the wallet can actually cover get a hold. The fingerprint is
    // the same tuple as `requestIntent`, so reusing this attempt key for a
    // different plan or price is refused instead of silently replayed.
    const reservation = await reserveWallet({
      userId: user.id,
      requestId,
      service: "esim",
      amount: offer.priceNgn,
      fingerprint: requestIntent ?? `${offerId}:${offer.priceNgn}`,
      ttlMs: ESIM_HOLD_TTL_MS,
    });
    if (reservation.kind === "conflict" || reservation.kind === "existing" || reservation.kind === "ineligible") {
      // The claim above is ours, so nothing else owns this attempt: any of these
      // means this request key is already spoken for. Cancel the row we just
      // wrote rather than leaving an order that can never be paid for.
      await db.update(orders).set({
        status: "cancelled",
        reconciliationNote: "This attempt key was already used or the account is unavailable; nothing was charged.",
      }).where(and(eq(orders.id, orderId), eq(orders.status, "review"))).catch(() => undefined);
      if (reservation.kind === "ineligible") {
        return Response.json({ ok: false, error: "This account cannot start a purchase. Nothing was charged." }, { status: 403 });
      }
      const winner = await findRequestOrder(user.id, requestId);
      if (winner && winner.id !== orderId) return replay(winner, await currentBalance(user.id), offerId, requestIntent);
      return Response.json({ ok: false, error: "Check your orders before trying again." }, { status: 409 });
    }
    if (reservation.kind === "insufficient") {
      // Release the claim we just took, because no hold backs it. Cancelling the
      // order (rather than leaving it in review) is what keeps the nightly
      // reconciliation from reporting an order nobody will ever pay for.
      await db.update(orders).set({
        status: "cancelled",
        reconciliationNote: "The wallet could not cover this order when it was reserved; nothing was charged and no supplier was contacted.",
      }).where(and(eq(orders.id, orderId), eq(orders.status, "review"))).catch(() => undefined);
      return Response.json(
        {
          ok: false,
          error: `Your wallet balance is ₦${reservation.balance.toLocaleString("en-NG")} — top up to continue.`,
          required: offer.priceNgn,
          balance: reservation.balance,
        },
        { status: 402 },
      );
    }

    reservationId = reservation.reservationId;
    // A non-null local for the rest of the attempt; the outer tracker above
    // exists only so the catch can still find the hold if this throws.
    const holdId = reservation.reservationId;
    // Bind the hold to its order so reconciliation and the review queue can show
    // both halves of the same attempt.
    await linkReservationToOrder({ reservationId: holdId, orderId }).catch(() => undefined);

    // Serialize the paid-provider boundary with suspension. Once this commits,
    // a suspension cannot cancel a supplier call that has already started.
    const eligible = await db.transaction(async (tx) => {
      const [account] = await tx.select({ suspendedAt: users.suspendedAt, deletedAt: users.deletedAt })
        .from(users).where(eq(users.id, user.id)).for("update").limit(1);
      if (!account || account.suspendedAt || account.deletedAt) {
        await tx.update(orders).set({ status: "cancelled", reconciliationNote: "Account unavailable before supplier purchase; the wallet hold was released and nothing was charged." })
          .where(and(eq(orders.id, orderId), eq(orders.status, "review")));
        // No supplier was contacted, so the hold is definitively unspent.
        await releaseReservation({
          tx,
          reservationId: holdId,
          userId: user.id,
          reason: "Account unavailable before the supplier was contacted",
        });
        return false;
      }
      const [started] = await tx.update(orders).set({ reconciliationNote: "eSIM provider purchase started; funds held. Nothing has been charged." })
        .where(and(eq(orders.id, orderId), eq(orders.status, "review"))).returning({ id: orders.id });
      if (!started) throw new Error("eSIM purchase claim unavailable");
      return true;
    });
    if (!eligible) return Response.json({ ok: false, error: "This account cannot start a purchase. Nothing was charged." }, { status: 403 });

    // From here the supplier may spend our balance on any failure path.
    supplierContacted = true;
    const outcome = await purchaseEsim(offer, async (providerOrderId) => {
      const [recorded] = await db.update(orders).set({
        providerRequestId: providerOrderId,
        reconciliationNote: "Supplier accepted the eSIM order; funds held pending delivery. Nothing has been charged.",
      }).where(and(eq(orders.id, orderId), eq(orders.status, "review"))).returning({ id: orders.id });
      if (!recorded) throw new Error("eSIM order is no longer awaiting a supplier outcome");
    });
    if (outcome.kind === "refused") {
      // A definitive refusal means the supplier took nothing. Cancel the order
      // and give the held funds back in the same transaction, so there is no
      // window in which the order says "cancelled" while the money is still held.
      const released = await db.transaction(async (tx) => {
        const [cancelled] = await tx.update(orders).set({
          status: "cancelled",
          reconciliationNote: "Supplier refused the eSIM purchase; the wallet hold was released and nothing was charged.",
        }).where(and(eq(orders.id, orderId), eq(orders.status, "review"))).returning({ id: orders.id });
        if (!cancelled) throw new Error("eSIM order is no longer awaiting a supplier outcome");
        return releaseReservation({
          tx,
          reservationId: holdId,
          userId: user.id,
          reason: "Supplier refused the eSIM purchase",
        });
      });
      return Response.json(
        { ok: false, error: "We couldn't deliver that eSIM right now — nothing was charged. Reload the plan if you want to try again.", safeToRetry: true, balance: released.balance },
        { status: 502 },
      );
    }

    if (outcome.kind === "unknown") {
      // The supplier may have taken our balance. Park the order *and* the hold:
      // the money stays reserved (never auto-released, never retried) until a
      // human confirms which way it went.
      const [reviewed] = await db.update(orders).set({
        reconciliationNote: "eSIM purchase outcome unknown at the supplier; the wallet hold requires reconciliation and nothing was charged.",
      }).where(and(eq(orders.id, orderId), eq(orders.status, "review"))).returning({ id: orders.id });
      if (!reviewed) throw new Error("eSIM order is no longer awaiting a supplier outcome");
      await holdForReview({
        reservationId: holdId,
        userId: user.id,
        note: "Supplier outcome unknown after an eSIM purchase",
      }).catch(() => undefined);
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
      // Settle the hold rather than debiting: the money already left the
      // spendable balance when it was reserved, so this cannot fail for want of
      // funds — which is exactly why the hold exists. The write, the ledger row
      // and the hold's closure are one transaction.
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
        const settled = await settleReservation({
          tx,
          reservationId: holdId,
          userId: user.id,
          amount: offer.priceNgn,
          description: `${shape.name} · ${shape.planLabel}`,
          orderId,
          reference,
        });
        if (settled.reservationAlreadyClosed) throw new Error("eSIM wallet hold was already closed elsewhere");
        return settled.balance;
      });
    } catch (error) {
      // The profile exists upstream and we cannot refund it ourselves. The
      // transaction rolled back, so the hold is still `held`; park it for a human
      // rather than releasing money for a profile the supplier already sold us.
      // The activation credential is deliberately not written onto an unpaid
      // order, but the provider reference is retained so an operator can find it.
      await db.update(orders).set({
        status: "review",
        providerRequestId: delivery.providerRequestId,
        reconciliationNote: "eSIM delivered but the wallet hold could not be settled; review before charging or releasing.",
      }).where(and(eq(orders.id, orderId), eq(orders.status, "review")));
      await holdForReview({
        reservationId: holdId,
        userId: user.id,
        note: "eSIM delivered but the hold could not be settled",
      }).catch(() => undefined);
      // A generic transaction error can happen after a commit was sent; its
      // outcome is not necessarily known. Never claim the wallet was untouched.
      return Response.json(
        { ok: false, error: "We couldn't confirm the order. Check your orders or contact support before trying again." },
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
    // The attempt was interrupted somewhere after the hold. Close it honestly:
    // if the supplier was never contacted the funds are definitively unspent and
    // go straight back; otherwise the outcome is unknown and a human decides.
    if (reservationId) {
      const held = reservationId;
      try {
        if (supplierContacted) {
          await holdForReview({
            reservationId: held,
            userId: user.id,
            note: "Interrupted after the supplier boundary",
          });
        } else {
          await db.transaction((tx) =>
            releaseReservation({
              tx,
              reservationId: held,
              userId: user.id,
              reason: "Attempt failed before the supplier was contacted",
            }),
          );
        }
      } catch {
        // Leaving the hold `held` surfaces it in the nightly report; throwing
        // here would hide the original failure.
      }
    }
    return Response.json({ ok: false, error: "We couldn't complete that order. Check your orders or contact support before trying again." }, { status: 500 });
  }
}
