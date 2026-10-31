import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuthApi } from "@/lib/auth";
import { db } from "@/db";
import { orders, users } from "@/db/schema";
import { calculateBulkOrder, expandBulkOrder, MAX_BULK_UNITS, type BulkOrderItem } from "@/lib/bulk-orders";
import { findPlan, type Plan } from "@/lib/catalog";
import { cancelUpstream, fulfillPlan, isPlanFulfillable, type FulfilledOrder } from "@/lib/fulfillment";
import { FleexaError } from "@/lib/fleexa";
import { debitWalletInTx, InsufficientFundsError, makeReference } from "@/lib/wallet";
import { isSameOriginMutation } from "@/lib/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { purchaseRateLimiter } from "@/lib/rate-limit";
import { scheduleWalletEmails } from "@/lib/schedule-wallet-emails";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The largest basket this route will buy from the supplier in one request.
 *
 * Every unit is a separate upstream purchase, so the ceiling is about bounding
 * a single request's work, not about catalogue size: at 20 units the worst case
 * still finishes inside `maxDuration`, and a basket that fails halfway has only
 * spent 20 upstream calls before it is released.
 */
const MAX_UNITS = MAX_BULK_UNITS;

type FulfilledUnit = { plan: Plan; amount: number; fulfilment: FulfilledOrder };

/** Best effort: a failed release must never mask the outcome of the request. */
async function releaseAll(fulfilled: FulfilledUnit[]): Promise<void> {
  for (const unit of fulfilled) {
    try {
      await cancelUpstream({
        provider: unit.fulfilment.provider,
        providerRequestId: unit.fulfilment.providerRequestId,
        service: unit.plan.service,
        duration: unit.plan.duration,
      });
    } catch (error) {
      console.error("Bulk upstream cancel failed", error);
    }
  }
}

/** Provider failures that mean "not available", with nothing bought or charged. */
function isUnavailable(error: unknown): boolean {
  if (!(error instanceof FleexaError)) return false;
  return (
    error.code === "NO_API_KEY" ||
    error.code === "SERVICE_UNAVAILABLE" ||
    error.code === "COST_UNKNOWN" ||
    error.code === "UNPROFITABLE"
  );
}

/**
 * Bulk checkout.
 *
 * This route used to record every unit as `delivered` with provider `manual`
 * and no fulfilment step at all: the wallet was debited, the orders said
 * delivered, and nothing was ever bought — no number, no code, and no row in
 * the hand-fulfilment queue (that queue only lists `processing`/`review`).
 *
 * It now buys first, records second, in the same order as the single-order
 * checkout: every unit is fulfilled upstream, and only then is the wallet
 * debited and the orders written in one transaction. If the supplier refuses
 * any unit, the units already bought are released and the customer is charged
 * nothing. Plans outside the fulfilment allowlist are refused up front rather
 * than sold as something that cannot arrive.
 */
export async function POST(request: NextRequest) {
  const user = await requireAuthApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }

  if (!isJsonRequest(request)) {
    return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
  }

  const limit = await purchaseRateLimiter(`bulk-create:${user.id}`);
  if (limit.unavailable) return NextResponse.json({ error: "Bulk orders are temporarily unavailable." }, { status: 503 });
  if (!limit.allowed) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });

  let body: unknown;
  try {
    body = await readJsonWithLimit(request, 16_384);
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const rawItems = (body as { items?: unknown }).items;
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 200) {
    return NextResponse.json({ error: "A basket must contain between 1 and 200 items" }, { status: 400 });
  }

  const bulkItems: BulkOrderItem[] = [];
  for (const item of rawItems) {
    if (!item || typeof item !== "object" || typeof (item as any).productSlug !== "string" || !Number.isInteger((item as any).quantity) || (item as any).quantity <= 0) {
      return NextResponse.json({ error: "Invalid item in bulk order" }, { status: 400 });
    }
    bulkItems.push({
      productSlug: (item as any).productSlug,
      quantity: (item as any).quantity,
    });
  }

  let calculated;
  try {
    calculated = calculateBulkOrder(bulkItems);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Invalid bulk calculation" }, { status: 400 });
  }

  const units = expandBulkOrder(calculated);
  if (units.length > MAX_UNITS) {
    return NextResponse.json(
      { error: `A bulk order can contain at most ${MAX_UNITS} items. Split it into smaller baskets.` },
      { status: 400 },
    );
  }

  // Refuse undeliverable lines before spending anything. A plan with no
  // supplier path would otherwise be paid for and never arrive.
  const undeliverable = calculated.items.filter((item) => !isPlanFulfillable(item.productSlug));
  if (undeliverable.length > 0) {
    return NextResponse.json(
      {
        error: `${undeliverable.map((item) => item.productName).join(", ")} cannot be delivered automatically yet, so ${
          undeliverable.length === 1 ? "it is" : "they are"
        } not available in a bulk order. Remove ${undeliverable.length === 1 ? "it" : "them"} and try again.`,
      },
      { status: 400 },
    );
  }

  const [account] = await db
    .select({ walletBalance: users.walletBalance })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  if (!account || account.walletBalance < calculated.total) {
    return NextResponse.json(
      { error: `Your wallet balance is ₦${(account?.walletBalance ?? 0).toLocaleString("en-NG")} — top up to continue.` },
      { status: 402 },
    );
  }

  // Buy every unit first. Nothing is charged until all of them resolve, so a
  // refused unit costs the customer nothing.
  const fulfilled: FulfilledUnit[] = [];
  for (const unit of units) {
    const plan = findPlan(unit.productSlug);
    if (!plan) {
      await releaseAll(fulfilled);
      return NextResponse.json({ error: "A plan in that basket is no longer available." }, { status: 400 });
    }
    try {
      fulfilled.push({ plan, amount: unit.amount, fulfilment: await fulfillPlan(plan) });
    } catch (error) {
      await releaseAll(fulfilled);
      console.error("Bulk fulfilment failed", error instanceof FleexaError ? error.code : error);
      return NextResponse.json(
        {
          error: isUnavailable(error)
            ? "Bulk fulfilment is temporarily unavailable — nothing was charged."
            : "We couldn't buy every item in that basket, so nothing was charged. Try a smaller basket or try again in a moment.",
        },
        { status: isUnavailable(error) ? 503 : 502 },
      );
    }
  }

  const now = new Date();
  try {
    const outcome = await db.transaction(async (tx: any) => {
      const [current] = await tx
        .select({ walletBalance: users.walletBalance })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      if (!current || current.walletBalance < calculated.total) {
        throw new InsufficientFundsError(current?.walletBalance ?? 0, calculated.total);
      }

      const batchReference = makeReference("BLK");
      for (const unit of fulfilled) {
        const { plan, fulfilment } = unit;
        await tx.insert(orders).values({
          id: randomUUID(),
          reference: makeReference("PRY"),
          userId: user.id,
          service: plan.service,
          productSlug: plan.slug,
          productName: plan.name,
          planLabel: plan.planLabel,
          region: plan.region,
          duration: plan.duration,
          amount: unit.amount,
          // Not "delivered": a number's code can still be on its way, exactly as
          // in a single order. The order page polls until it arrives.
          status: "active",
          provider: fulfilment.provider,
          providerCostNgn: fulfilment.providerCostNgn,
          providerRequestId: fulfilment.providerRequestId,
          referenceCode: fulfilment.referenceCode,
          otpCode: fulfilment.otpCode,
          expiresAt: fulfilment.expiresAt,
          createdAt: now,
        });
      }

      const balance = await debitWalletInTx(tx, {
        userId: user.id,
        amount: calculated.total,
        type: "debit",
        description: `Bulk purchase: ${fulfilled.length} ${fulfilled.length === 1 ? "item" : "items"}`,
        reference: batchReference,
      });

      return { balance, count: fulfilled.length, reference: batchReference };
    });

    scheduleWalletEmails();
    return NextResponse.json({ ok: true, ...outcome });
  } catch (error) {
    // The units were bought and nothing was recorded, so release them rather
    // than holding paid-for stock.
    await releaseAll(fulfilled);
    if (error instanceof InsufficientFundsError) {
      return NextResponse.json(
        { error: `Your wallet balance is ₦${error.balance.toLocaleString("en-NG")} — top up to continue.` },
        { status: 402 },
      );
    }
    console.error("Bulk purchase failed", error);
    return NextResponse.json({ error: "Failed to complete bulk purchase" }, { status: 500 });
  }
}
