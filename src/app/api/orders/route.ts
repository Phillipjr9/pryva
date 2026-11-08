import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, users, type Order } from "@/db/schema";
import { afterPurchase, beginPurchase } from "@/lib/checkout/purchase";
import { getCurrentUser } from "@/lib/identity/auth";
import { findPlan, type Plan } from "@/lib/services/catalog";
import { FleexaError } from "@/lib/providers/fleexa";
import { cancelUpstream, fulfilmentIntent, fulfillPlan, type FulfilledOrder } from "@/lib/services/fulfillment";
import { debitWalletInTx, InsufficientFundsError, makeReference } from "@/lib/payments/wallet";
import { findOtpCheckoutOffer } from "@/lib/services/numbers/otp-catalog";
import { isAmbiguousOtpPurchase } from "@/lib/services/numbers/otp-suppliers";
import { ORDER_PROVIDERS } from "@/lib/services/order-providers";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PurchaseOutcome = { kind: "created"; balance: number } | { kind: "replay"; order: Order };
type ReceiptSource = Pick<
  Order, "id" | "reference" | "productName" | "planLabel" | "service" | "amount" | "status"
>;

/**
 * The response for a purchase, and identically for a replayed one. A retry must
 * be indistinguishable from the original success, or the client cannot tell that
 * its first attempt already bought the number.
 */
function receipt(order: ReceiptSource, balance: number, replayed: boolean) {
  return Response.json({
    ok: true,
    balance,
    replayed,
    pending: order.status === "review" || order.status === "processing",
    ...(order.status === "review" || order.status === "processing"
      ? { message: "This order needs review. Check the order status and wallet balance before retrying." }
      : {}),
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

async function findRequestOrder(userId: string, requestId: string): Promise<Order | null> {
  const [row] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.requestId, requestId)))
    .limit(1);
  return row ?? null;
}

async function currentBalance(userId: string): Promise<number> {
  const [row] = await db
    .select({ balance: users.walletBalance })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.balance ?? 0;
}

/** Best effort: a failed release must never mask the outcome of the purchase. */
async function releaseUpstream(fulfilled: FulfilledOrder, plan: Plan): Promise<void> {
  try {
    await cancelUpstream({
      provider: fulfilled.provider,
      providerRequestId: fulfilled.providerRequestId,
      service: plan.service,
    });
  } catch (cancelError) {
    console.error("Upstream cancel failed", cancelError);
  }
}

/** Postgres unique_violation: the (user_id, request_id) index won the race. */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "23505";
}

async function placeAppOtpOrder(
  userId: string,
  plan: Plan,
  requestId: string,
  otpOfferId: string,
): Promise<Response> {
  const intent = fulfilmentIntent(plan.slug);
  if (!intent || intent.kind !== "sms") {
    return Response.json({ ok: false, error: "App-specific offers are only available for single-use numbers." }, { status: 400 });
  }

  const existing = await findRequestOrder(userId, requestId);
  if (existing) {
    if (existing.status === "cancelled") {
      return Response.json({ ok: false, error: "This attempt was not completed. Start a new purchase to try again.", safeToRetry: true }, { status: 409 });
    }
    return receipt(existing, await currentBalance(userId), true);
  }

  const current = await currentBalance(userId);
  if (current < plan.price) {
    return Response.json({ ok: false, error: `Your wallet balance is ₦${current.toLocaleString("en-NG")} — top up to continue.` }, { status: 402 });
  }

  let resolved: Awaited<ReturnType<typeof findOtpCheckoutOffer>>;
  try {
    resolved = await findOtpCheckoutOffer(intent.country, otpOfferId, { refresh: true });
  } catch {
    return Response.json({ ok: false, error: "The live service could not be confirmed. No order was created or charged.", safeToRetry: true }, { status: 503 });
  }
  const { listing, errorCode } = resolved;
  if (errorCode || !listing || !listing.purchasable || listing.priceNgn !== plan.price) {
    return Response.json({
      ok: false,
      error: errorCode ? "The live service could not be confirmed. No order was created or charged." : "That app offer is no longer available at this price. No order was created or charged.",
      safeToRetry: true,
    }, { status: errorCode ? 503 : 409 });
  }

  const orderId = randomUUID();
  const reference = makeReference("PRY");
  const planLabel = `${plan.planLabel} · ${listing.app}`.slice(0, 120);
  const claimed = await db.insert(orders).values({
    id: orderId,
    reference,
    userId,
    requestId,
    service: plan.service,
    productSlug: plan.slug,
    productName: listing.app,
    planLabel,
    region: plan.region,
    duration: plan.duration,
    amount: plan.price,
    status: "review",
    provider: ORDER_PROVIDERS.bitcall,
    reconciliationNote: "App-specific OTP order claimed before provider call; nothing has been charged.",
  }).onConflictDoNothing({ target: [orders.userId, orders.requestId] }).returning({ id: orders.id });
  if (claimed.length === 0) {
    const winner = await findRequestOrder(userId, requestId);
    if (winner && winner.status !== "cancelled") return receipt(winner, await currentBalance(userId), true);
    return Response.json({ ok: false, error: "Check your orders before trying again.", safeToRetry: true }, { status: 409 });
  }

  let providerCallStarted = false;
  let fulfilled: FulfilledOrder;
  try {
    fulfilled = await fulfillPlan(plan, {
      otpOfferId,
      onOtpAttempt: async () => {
        const [updated] = await db.update(orders).set({
          reconciliationNote: "Bitcall OTP purchase call started; outcome is being tracked. Nothing has been charged.",
        }).where(and(eq(orders.id, orderId), eq(orders.status, "review"))).returning({ id: orders.id });
        if (!updated) throw new Error("OTP order claim is no longer available");
        providerCallStarted = true;
      },
      onOtpAccepted: async (providerRequestId) => {
        const [updated] = await db.update(orders).set({
          providerRequestId,
          reconciliationNote: "Bitcall accepted the OTP activation; delivery and charge are pending review. Nothing has been charged.",
        }).where(and(eq(orders.id, orderId), eq(orders.status, "review"))).returning({ id: orders.id });
        if (!updated) throw new Error("OTP order claim is no longer available");
      },
    });
  } catch (error) {
    const ambiguous = providerCallStarted && isAmbiguousOtpPurchase(error);
    if (ambiguous) {
      await db.update(orders).set({
        reconciliationNote: "The Bitcall OTP purchase outcome is uncertain. No wallet charge was made; reconcile before any retry.",
      }).where(and(eq(orders.id, orderId), eq(orders.status, "review")));
      return Response.json({
        ok: true,
        pending: true,
        balance: await currentBalance(userId),
        order: { id: orderId, reference, productName: listing.app, planLabel, service: plan.service, amount: plan.price, status: "review" },
        message: "The purchase needs a manual check. Nothing has been charged; do not submit it again yet.",
      }, { status: 202 });
    }

    await db.update(orders).set({
      status: "cancelled",
      reconciliationNote: "Bitcall did not confirm a purchase; nothing was charged.",
    }).where(and(eq(orders.id, orderId), eq(orders.status, "review")));
    return Response.json({
      ok: false,
      error: "We couldn't confirm that app offer. Nothing was charged; you can safely start a new attempt.",
      safeToRetry: true,
    }, { status: 503 });
  }

  try {
    const balance = await db.transaction(async (tx: any) => {
      const [activated] = await tx.update(orders).set({
        status: "active",
        provider: fulfilled.provider,
        providerCostNgn: fulfilled.providerCostNgn,
        providerRequestId: fulfilled.providerRequestId,
        referenceCode: fulfilled.referenceCode,
        otpCode: fulfilled.otpCode,
        expiresAt: fulfilled.expiresAt,
        reconciliationNote: null,
      }).where(and(eq(orders.id, orderId), eq(orders.status, "review"))).returning({ id: orders.id });
      if (!activated) throw new Error("OTP order claim is no longer awaiting activation");
      return debitWalletInTx(tx, {
        userId,
        amount: plan.price,
        type: "debit",
        description: `${listing.app} · ${planLabel}`.slice(0, 200),
        orderId,
        reference,
      });
    });
    void afterPurchase(userId);
    return receipt({
      id: orderId,
      reference,
      productName: listing.app,
      planLabel,
      service: plan.service,
      amount: plan.price,
      status: "active",
    }, balance, false);
  } catch (error) {
    // A connection error can arrive after the transaction committed. Read back
    // the idempotency row before describing the charge as uncertain.
    const persisted = await findRequestOrder(userId, requestId);
    if (persisted?.status === "active") return receipt(persisted, await currentBalance(userId), true);

    // The provider activation is already confirmed. Rollback leaves the order in
    // review and the accepted provider reference persisted; never buy again or
    // charge based on an uncertain database outcome.
    const insufficient = error instanceof InsufficientFundsError;
    await db.update(orders).set({
      status: "review",
      providerRequestId: fulfilled.providerRequestId,
      providerCostNgn: fulfilled.providerCostNgn,
      reconciliationNote: insufficient
        ? "Bitcall accepted the OTP activation but the wallet no longer covered it; nothing was charged."
        : "Bitcall accepted the OTP activation but the wallet charge requires reconciliation.",
    }).where(and(eq(orders.id, orderId), eq(orders.status, "review")));
    return Response.json({
      ok: true,
      pending: true,
      balance: await currentBalance(userId),
      order: { id: orderId, reference, productName: listing.app, planLabel, service: plan.service, amount: plan.price, status: "review" },
      message: insufficient
        ? "The provider accepted the activation but your wallet no longer covered the order. Nothing was charged; do not submit it again yet."
        : "We could not confirm the wallet charge. Check this order and your balance before retrying.",
    }, { status: 202 });
  }
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.userId, user.id))
    .orderBy(desc(orders.createdAt))
    .limit(50);

  const customerOrders = rows.map((order) => {
    const {
      provider: _provider,
      providerCostNgn: _providerCostNgn,
      providerRequestId: _providerRequestId,
      requestId: _requestId,
      reconciliationNote: _reconciliationNote,
      ...customerOrder
    } = order;
    return customerOrder;
  });
  return Response.json({ ok: true, orders: customerOrders });
}

export async function POST(request: Request) {
  const begun = await beginPurchase<Record<string, unknown>>(request, {
    bucket: "order-create",
    maxBodyBytes: 2_048,
    copy: { tooFast: "That is a lot of orders in a short time. Please try again in a few minutes." },
  });
  if (!begun.ok) return begun.response;
  const { user, body } = begun;

  const planSlug = body && typeof body === "object" && !Array.isArray(body) ? (body as { planSlug?: unknown }).planSlug : null;
  if (typeof planSlug !== "string" || !planSlug || planSlug.length > 80) return Response.json({ ok: false, error: "Invalid plan." }, { status: 400 });

  // One key per purchase attempt, supplied by the client and stable across a
  // retry of that attempt. Frequency limiting and a disabled button stop a
  // double click, but not a browser retry, a second tab, or a resubmit after a
  // timeout whose first attempt succeeded -- and because fulfilment runs first,
  // each of those used to buy a second real number and debit the wallet twice.
  // A time-based dedupe would be wrong: buying the same plan twice in a row is
  // legitimate for virtual numbers, so the key has to come from the client.
  const rawRequestId = body && typeof body === "object" && !Array.isArray(body) ? (body as { requestId?: unknown }).requestId : null;
  if (typeof rawRequestId !== "string" || !UUID.test(rawRequestId)) {
    return Response.json({ ok: false, error: "Invalid purchase request. Please try again." }, { status: 400 });
  }
  const requestId = rawRequestId.toLowerCase();
  const rawOtpOfferId = body && typeof body === "object" && !Array.isArray(body) ? (body as { otpOfferId?: unknown }).otpOfferId : undefined;
  if (rawOtpOfferId !== undefined && (typeof rawOtpOfferId !== "string" || !/^otp-[a-f0-9]{24}$/.test(rawOtpOfferId))) {
    return Response.json({ ok: false, error: "Invalid app offer." }, { status: 400 });
  }

  try {
    const plan = findPlan(planSlug);

    if (!plan) {
      return Response.json({ ok: false, error: "That plan is no longer available." }, { status: 400 });
    }

    if (typeof rawOtpOfferId === "string") {
      if (!fulfilmentIntent(plan.slug) || fulfilmentIntent(plan.slug)?.kind !== "sms") {
        return Response.json({ ok: false, error: "App-specific offers are only available for single-use numbers." }, { status: 400 });
      }
      return await placeAppOtpOrder(user.id, plan, requestId, rawOtpOfferId);
    }

    if (user.walletBalance < plan.price) {
      return Response.json({ ok: false, error: "Your wallet balance is too low for this order." }, { status: 402 });
    }

    // Replay before spending anything. This is the common duplicate -- a resubmit
    // after a timeout whose first attempt actually succeeded -- and it must cost
    // neither a second number nor a second debit.
    const alreadyPurchased = await findRequestOrder(user.id, requestId);
    if (alreadyPurchased) return receipt(alreadyPurchased, await currentBalance(user.id), true);

    // Fulfil first using the configured supplier; ephemeral and preview environments were refused above.
    // No wallet charge is made until fulfilment succeeds.
    let fulfilled: FulfilledOrder;
    try {
      fulfilled = await fulfillPlan(plan);
    } catch (error) {
      if (error instanceof FleexaError) {
        console.error("Fleexa fulfilment failed", error.code, error.message);
        // Every one of these leaves nothing bought and nothing charged, so they
        // read as "unavailable" rather than a provider failure. The margin codes
        // in particular must not leak wholesale economics into the wording a
        // customer sees -- the figures stay in the server log above.
        const unavailable =
          error.code === "NO_API_KEY" ||
          error.code === "SERVICE_UNAVAILABLE" ||
          error.code === "COST_UNKNOWN" ||
          error.code === "UNPROFITABLE";
        return Response.json(
          {
            ok: false,
            error: unavailable
              ? "Fulfilment is temporarily unavailable."
              : "Our provider couldn't fulfil that right now — nothing was charged. Try again in a moment.",
          },
          { status: unavailable ? 503 : 502 },
        );
      }
      throw error;
    }

    const reference = makeReference("PRY");
    const orderId = randomUUID();

    // 2. Record the order and charge the wallet as one transaction, arbitrated by
    //    the unique (user_id, request_id) index. Either both land or neither
    //    does. Splitting them meant a crash in between left an order row with no
    //    matching debit -- which the automatic refund sweep would later credit
    //    back to the customer as money that was never taken.
    let outcome: PurchaseOutcome;
    try {
      outcome = await db.transaction(async (tx: any): Promise<PurchaseOutcome> => {
        // A concurrent attempt may have committed after the pre-flight check.
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
          service: plan.service,
          productSlug: plan.slug,
          productName: plan.name,
          // A fallback supplier sells app-specific pools. When that happens the
          // order says which app the number was bought for, because "a number"
          // that only works for one service is a different promise.
          planLabel: fulfilled.serviceLabel
            ? `${plan.planLabel} · ${fulfilled.serviceLabel}`.slice(0, 120)
            : plan.planLabel,
          region: plan.region,
          duration: plan.duration,
          amount: plan.price,
          status: "active",
          provider: fulfilled.provider,
          providerCostNgn: fulfilled.providerCostNgn,
          providerRequestId: fulfilled.providerRequestId,
          referenceCode: fulfilled.referenceCode,
          otpCode: fulfilled.otpCode,
          expiresAt: fulfilled.expiresAt,
        });

        const balance = await debitWalletInTx(tx, {
          userId: user.id,
          amount: plan.price,
          type: "debit",
          description: `${plan.name} · ${plan.planLabel}`,
          orderId,
          reference,
        });
        return { kind: "created", balance };
      });
    } catch (error) {
      // Nothing was recorded and nothing was charged, but the number was already
      // bought -- release it, or a failed charge leaves us holding paid-for stock.
      await releaseUpstream(fulfilled, plan);

      if (error instanceof InsufficientFundsError) {
        return Response.json(
          {
            ok: false,
            error: `Your wallet balance is ₦${error.balance.toLocaleString("en-NG")} — top up to continue.`,
            required: error.required,
            balance: error.balance,
          },
          { status: 402 },
        );
      }
      if (isUniqueViolation(error)) {
        // Lost a genuine race. The winner's order is this customer's order, so
        // return it instead of buying a second number.
        const winner = await findRequestOrder(user.id, requestId);
        if (winner) return receipt(winner, await currentBalance(user.id), true);
      }
      throw error;
    }

    if (outcome.kind === "replay") {
      return receipt(outcome.order, await currentBalance(user.id), true);
    }

    // Best effort: the receipt queue and a reward for whoever invited this
    // customer, paid once their first delivered order exists. Neither may affect
    // this purchase, and both run on every money path, not just this one.
    void afterPurchase(user.id);
    return receipt(
      {
        id: orderId,
        reference,
        productName: plan.name,
        planLabel: plan.planLabel,
        service: plan.service,
        amount: plan.price,
        status: "active",
      },
      outcome.balance,
      false,
    );
  } catch {
    return Response.json(
      { ok: false, error: "We couldn't complete that order. Please try again." },
      { status: 500 },
    );
  }
}
