import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { orders, users, type Order } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { findEsimOffer, type EsimOffer } from "@/lib/esim-catalog";
import { purchaseEsim } from "@/lib/esim-fulfilment";
import { purchaseVelocity, recordFraudEvent } from "@/lib/fraud";
import { MARGIN_BLOCKED_MESSAGE } from "@/lib/margin-guard";
import { isSameOriginMutation } from "@/lib/net";
import { ESIM_PROVIDER } from "@/lib/order-providers";
import { purchaseRateLimiter } from "@/lib/rate-limit";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { scheduleWalletEmails } from "@/lib/schedule-wallet-emails";
import { settleReferralRewards } from "@/lib/referrals";
import { debitWalletInTx, InsufficientFundsError, makeReference } from "@/lib/wallet";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    provider: order.provider,
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

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "23505";
}

/**
 * Buy an eSIM plan.
 *
 * Money moves only once the activation material is in hand, so the three
 * outcomes that matter are:
 *
 *   * **delivered** — record `active`, store the profile, debit once;
 *   * **provisioning** — record `processing`, charge nothing, and let the order
 *     page / nightly sweep finish it;
 *   * **unknown** — the supplier may have bought it, so nothing is retried and
 *     the order is parked on the review queue with no charge.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Please sign in to complete this order." }, { status: 401 });

  if (!isSameOriginMutation(request)) {
    return Response.json({ ok: false, error: "Cross-origin request denied." }, { status: 403 });
  }
  if (!isJsonRequest(request)) return Response.json({ ok: false, error: "Expected JSON." }, { status: 415 });

  const limit = await purchaseRateLimiter(`esim-create:${user.id}`);
  if (limit.unavailable) return Response.json({ ok: false, error: "Purchases are temporarily unavailable." }, { status: 503 });
  if (!limit.allowed) return Response.json({ ok: false, error: "Too many attempts. Try again later." }, { status: 429 });

  const velocity = await purchaseVelocity(user.id).catch(() => ({ allowed: true, count: 0, limit: 0 }));
  if (!velocity.allowed) {
    await recordFraudEvent({
      userId: user.id,
      kind: "purchase_velocity",
      severity: "warn",
      reasons: [`${velocity.count} orders in the last hour (limit ${velocity.limit})`],
    });
    return Response.json(
      { ok: false, error: "That is a lot of orders in a short time. Please try again in a few minutes." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await readJsonWithLimit(request, 2_048);
  } catch (error) {
    return Response.json(
      { ok: false, error: "Invalid request body." },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }

  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const offerId = typeof record.offerId === "string" ? record.offerId : null;
  if (!offerId || offerId.length > 64) {
    return Response.json({ ok: false, error: "Invalid plan." }, { status: 400 });
  }
  const rawRequestId = typeof record.requestId === "string" ? record.requestId : null;
  if (!rawRequestId || !UUID.test(rawRequestId)) {
    return Response.json({ ok: false, error: "Invalid purchase request. Please try again." }, { status: 400 });
  }
  const requestId = rawRequestId.toLowerCase();

  try {
    // Replay first: a resubmit after a timeout must not buy a second profile.
    const already = await findRequestOrder(user.id, requestId);
    if (already) return receipt(already, await currentBalance(user.id), true);

    const offer = await findEsimOffer(offerId);
    if (!offer) return Response.json({ ok: false, error: "That eSIM plan is no longer available." }, { status: 400 });
    if (!offer.purchasable) return Response.json({ ok: false, error: MARGIN_BLOCKED_MESSAGE }, { status: 503 });

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

    const outcome = await purchaseEsim(offer);
    const reference = makeReference("PRY");
    const orderId = randomUUID();
    const shape = planShape(offer);

    if (outcome.kind === "refused") {
      return Response.json(
        { ok: false, error: "Our provider couldn't deliver that eSIM right now — nothing was charged. Try again in a moment." },
        { status: 502 },
      );
    }

    if (outcome.kind === "unknown") {
      await db.insert(orders).values({
        id: orderId,
        reference,
        userId: user.id,
        requestId,
        service: "esim",
        productSlug: shape.slug,
        productName: shape.name,
        planLabel: shape.planLabel,
        region: shape.region,
        duration: shape.duration,
        amount: offer.priceNgn,
        status: "review",
        provider: ESIM_PROVIDER,
        providerCostNgn: offer.costNgn,
        reconciliationNote: "eSIM purchase outcome unknown at the supplier; nothing was charged.",
      });
      return Response.json(
        {
          ok: true,
          pending: true,
          balance: await currentBalance(user.id),
          order: { id: orderId, reference, productName: shape.name, planLabel: shape.planLabel, service: "esim", amount: offer.priceNgn, status: "review" },
          provider: ESIM_PROVIDER,
          message: "We're confirming this purchase with our supplier. Nothing has been charged yet.",
        },
        { status: 202 },
      );
    }

    if (outcome.kind === "pending") {
      await db.insert(orders).values({
        id: orderId,
        reference,
        userId: user.id,
        requestId,
        service: "esim",
        productSlug: shape.slug,
        productName: shape.name,
        planLabel: shape.planLabel,
        region: shape.region,
        duration: shape.duration,
        amount: offer.priceNgn,
        status: "processing",
        provider: ESIM_PROVIDER,
        providerRequestId: outcome.providerRequestId,
        providerCostNgn: offer.costNgn,
      });
      return Response.json(
        {
          ok: true,
          pending: true,
          balance: await currentBalance(user.id),
          order: { id: orderId, reference, productName: shape.name, planLabel: shape.planLabel, service: "esim", amount: offer.priceNgn, status: "processing" },
          provider: ESIM_PROVIDER,
          message: "Your eSIM is provisioning. It appears on this order as soon as it is ready, and you are only charged then.",
        },
        { status: 202 },
      );
    }

    const { delivery } = outcome;
    let outcomeTx: { kind: "created"; balance: number } | { kind: "replay"; order: Order };
    try {
      outcomeTx = await db.transaction(async (tx: any) => {
        const [raced] = await tx
          .select()
          .from(orders)
          .where(and(eq(orders.userId, user.id), eq(orders.requestId, requestId)))
          .limit(1);
        if (raced) return { kind: "replay", order: raced };

        await tx.insert(orders).values({
          id: orderId,
          reference,
          userId: user.id,
          requestId,
          service: "esim",
          productSlug: shape.slug,
          productName: shape.name,
          planLabel: shape.planLabel,
          region: shape.region,
          duration: shape.duration,
          amount: offer.priceNgn,
          status: "active",
          provider: delivery.provider,
          providerRequestId: delivery.providerRequestId,
          providerCostNgn: offer.costNgn,
          referenceCode: delivery.iccid,
          esimIccid: delivery.iccid,
          esimActivationCode: delivery.activationCode,
          esimInstallUrl: delivery.installUrl,
        });

        const balance = await debitWalletInTx(tx, {
          userId: user.id,
          amount: offer.priceNgn,
          type: "debit",
          description: `${shape.name} · ${shape.planLabel}`.slice(0, 200),
          orderId,
          reference,
        });
        return { kind: "created" as const, balance };
      });
    } catch (error) {
      // The profile exists upstream and we cannot refund it ourselves. Park it
      // for an operator instead of silently losing a paid-for unit.
      if (error instanceof InsufficientFundsError || isUniqueViolation(error)) {
        await db.insert(orders).values({
          id: orderId,
          reference,
          userId: user.id,
          requestId: `${requestId}`,
          service: "esim",
          productSlug: shape.slug,
          productName: shape.name,
          planLabel: shape.planLabel,
          region: shape.region,
          duration: shape.duration,
          amount: offer.priceNgn,
          status: "review",
          provider: ESIM_PROVIDER,
          providerRequestId: delivery.providerRequestId,
          providerCostNgn: offer.costNgn,
          reconciliationNote: "eSIM delivered by the supplier but the charge could not be recorded; nothing was charged.",
        }).onConflictDoNothing();
        if (isUniqueViolation(error)) {
          const winner = await findRequestOrder(user.id, requestId);
          if (winner) return receipt(winner, await currentBalance(user.id), true);
        }
        return Response.json(
          { ok: false, error: "We couldn't finish recording that order — nothing was charged. Contact support with your reference." },
          { status: 409 },
        );
      }
      throw error;
    }

    if (outcomeTx.kind === "replay") return receipt(outcomeTx.order, await currentBalance(user.id), true);

    scheduleWalletEmails();
    await settleReferralRewards({ refereeId: user.id }).catch(() => undefined);

    return Response.json({
      ok: true,
      balance: outcomeTx.balance,
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
      provider: delivery.provider,
    });
  } catch {
    return Response.json({ ok: false, error: "We couldn't complete that order. Please try again." }, { status: 500 });
  }
}
