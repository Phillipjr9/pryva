import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, users, type Order } from "@/db/schema";
import { afterPurchase, beginPurchase } from "@/lib/checkout/purchase";
import { getCurrentUser } from "@/lib/identity/auth";
import { findPlan, type Plan } from "@/lib/services/catalog";
import { FleexaError } from "@/lib/providers/fleexa";
import { cancelUpstream, fulfillPlan, type FulfilledOrder } from "@/lib/services/fulfillment";
import { debitWalletInTx, InsufficientFundsError, makeReference } from "@/lib/payments/wallet";

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

  // This is an order index, not an operator view. Do not expose internal
  // reconciliation notes, supplier costs or eSIM/account bearer credentials.
  const rows = await db
    .select({
      id: orders.id,
      reference: orders.reference,
      service: orders.service,
      productSlug: orders.productSlug,
      productName: orders.productName,
      planLabel: orders.planLabel,
      region: orders.region,
      duration: orders.duration,
      amount: orders.amount,
      status: orders.status,
      referenceCode: orders.referenceCode,
      otpCode: orders.otpCode,
      targetLink: orders.targetLink,
      quantity: orders.quantity,
      expiresAt: orders.expiresAt,
      refundedAt: orders.refundedAt,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(eq(orders.userId, user.id))
    .orderBy(desc(orders.createdAt))
    .limit(50);

  return Response.json({ ok: true, orders: rows }, { headers: { "Cache-Control": "private, no-store" } });
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

    // Fulfil first using the configured supplier; ephemeral and preview environments were refused above.
    // No wallet charge is made until fulfilment succeeds.
    let fulfilled: FulfilledOrder;
    try {
      fulfilled = await fulfillPlan(plan);
    } catch (error) {
      if (error instanceof FleexaError) {
        console.error("Fleexa fulfilment failed", error.code, error.message);
        // The margin codes must not leak wholesale economics into the wording a
        // customer sees. Another attempt with this request ID may be in flight,
        // so even a refusal here does not establish its overall outcome.
        const unavailable =
          error.code === "NO_API_KEY" ||
          error.code === "SERVICE_UNAVAILABLE" ||
          error.code === "COST_UNKNOWN" ||
          error.code === "UNPROFITABLE";
        return Response.json(
          {
            ok: false,
            error: unavailable
              ? "This service is temporarily unavailable. Check your orders before trying again."
              : "We couldn't confirm this order. Check your orders and wallet or contact support before trying again.",
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
      // Existing cleanup releases the purchased item on a transaction error.
      // A lost COMMIT acknowledgement is ambiguous, so this can also release
      // an item whose order and debit committed; that requires reconciliation.
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
        provider: fulfilled.provider,
      },
      outcome.balance,
      false,
    );
  } catch {
    return Response.json(
      { ok: false, error: "We couldn't confirm this order. Check your orders and wallet or contact support before trying again." },
      { status: 500 },
    );
  }
}
