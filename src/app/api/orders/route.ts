import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, users, type Order } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { findPlan, type Plan } from "@/lib/catalog";
import { FleexaError } from "@/lib/fleexa";
import { cancelUpstream, fulfillPlan, type FulfilledOrder } from "@/lib/fulfillment";
import { debitWalletInTx, InsufficientFundsError, makeReference } from "@/lib/wallet";
import { scheduleWalletEmails } from "@/lib/schedule-wallet-emails";
import { settleReferralRewards } from "@/lib/referrals";
import { purchaseVelocity, recordFraudEvent } from "@/lib/fraud";
import { isSameOriginMutation } from "@/lib/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { purchaseRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PurchaseOutcome = { kind: "created"; balance: number } | { kind: "replay"; order: Order };
type ReceiptSource = Pick<
  Order, "id" | "reference" | "productName" | "planLabel" | "service" | "amount" | "provider"
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
    order: {
      id: order.id,
      reference: order.reference,
      productName: order.productName,
      planLabel: order.planLabel,
      service: order.service,
      amount: order.amount,
    },
    provider: order.provider,
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

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.userId, user.id))
    .orderBy(desc(orders.createdAt))
    .limit(50);

  return Response.json({ ok: true, orders: rows });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ ok: false, error: "Please sign in to complete this order." }, { status: 401 });
  }

  if (!isSameOriginMutation(request)) {
    return Response.json({ ok: false, error: "Cross-origin request denied." }, { status: 403 });
  }

  if (!isJsonRequest(request)) return Response.json({ ok: false, error: "Expected JSON." }, { status: 415 });
  const limit = await purchaseRateLimiter(`order-create:${user.id}`);
  if (limit.unavailable) return Response.json({ ok: false, error: "Purchases are temporarily unavailable." }, { status: 503 });
  if (!limit.allowed) return Response.json({ ok: false, error: "Too many attempts. Try again later." }, { status: 429 });

  // A ceiling on orders per hour, counted from the database so it holds across
  // instances. The per-minute limiter above stops a burst; this stops a script
  // that paces itself. Failing to read the count is not a reason to refuse a
  // purchase, so the check is best effort in that direction only.
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
    return Response.json({ ok: false, error: "Invalid request body." }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
  }
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

  try {
    const plan = findPlan(planSlug);

    if (!plan) {
      return Response.json({ ok: false, error: "That plan is no longer available." }, { status: 400 });
    }

    if (user.walletBalance < plan.price) {
      return Response.json({ ok: false, error: "Your wallet balance is too low for this order." }, { status: 402 });
    }

    // Replay before spending anything. This is the common duplicate -- a resubmit
    // after a timeout whose first attempt actually succeeded -- and it must cost
    // neither a second number nor a second debit.
    const alreadyPurchased = await findRequestOrder(user.id, requestId);
    if (alreadyPurchased) return receipt(alreadyPurchased, await currentBalance(user.id), true);

    // Fulfil first; only in-memory previews use simulated provider data.
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
          planLabel: plan.planLabel,
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

    scheduleWalletEmails();
    // Best effort: a reward for the person who invited this customer, paid once
    // their first delivered order exists. It must never affect this purchase.
    await settleReferralRewards({ refereeId: user.id }).catch(() => undefined);
    return receipt(
      {
        id: orderId,
        reference,
        productName: plan.name,
        planLabel: plan.planLabel,
        service: plan.service,
        amount: plan.price,
        provider: fulfilled.provider,
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
