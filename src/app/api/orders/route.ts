import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { findPlan } from "@/lib/catalog";
import { FleexaError } from "@/lib/fleexa";
import { cancelUpstream, fulfillPlan } from "@/lib/fulfillment";
import { InsufficientFundsError, debitWallet, makeReference } from "@/lib/wallet";
import { isSameOriginMutation } from "@/lib/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { purchaseRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

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

  let body: unknown;
  try {
    body = await readJsonWithLimit(request, 2_048);
  } catch (error) {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
  }
  const planSlug = body && typeof body === "object" && !Array.isArray(body) ? (body as { planSlug?: unknown }).planSlug : null;
  if (typeof planSlug !== "string" || !planSlug || planSlug.length > 80) return Response.json({ ok: false, error: "Invalid plan." }, { status: 400 });

  try {
    const plan = findPlan(planSlug);

    if (!plan) {
      return Response.json({ ok: false, error: "That plan is no longer available." }, { status: 400 });
    }

    if (user.walletBalance < plan.price) {
      return Response.json({ ok: false, error: "Your wallet balance is too low for this order." }, { status: 402 });
    }

    // Fulfil first; only in-memory previews use simulated provider data.
    // No wallet charge is made until fulfilment succeeds.
    let fulfilled;
    try {
      fulfilled = await fulfillPlan(plan);
    } catch (error) {
      if (error instanceof FleexaError) {
        console.error("Fleexa fulfilment failed", error.code, error.message);
        return Response.json(
          {
            ok: false,
            error:
              error.code === "NO_API_KEY" || error.code === "SERVICE_UNAVAILABLE"
                ? "Fulfilment is temporarily unavailable."
                : "Our provider couldn't fulfil that right now — nothing was charged. Try again in a moment.",
          },
          { status: error.code === "NO_API_KEY" || error.code === "SERVICE_UNAVAILABLE" ? 503 : 502 },
        );
      }
      throw error;
    }

    const reference = makeReference("PRY");
    const orderId = randomUUID();

    await db.insert(orders).values({
      id: orderId,
      reference,
      userId: user.id,
      service: plan.service,
      productSlug: plan.slug,
      productName: plan.name,
      planLabel: plan.planLabel,
      region: plan.region,
      duration: plan.duration,
      amount: plan.price,
      status: "active",
      provider: fulfilled.provider,
      providerRequestId: fulfilled.providerRequestId,
      referenceCode: fulfilled.referenceCode,
      otpCode: fulfilled.otpCode,
      expiresAt: fulfilled.expiresAt,
    });

    // 2. Charge the Pryva wallet. If the wallet can't pay, cancel the
    //    upstream order (Fleexa refunds their wallet automatically) and
    //    remove the local order.
    try {
      const balance = await debitWallet({
        userId: user.id,
        amount: plan.price,
        type: "debit",
        description: `${plan.name} · ${plan.planLabel}`,
        orderId,
        reference,
      });

      return Response.json({
        ok: true,
        balance,
        order: {
          id: orderId,
          reference,
          productName: plan.name,
          planLabel: plan.planLabel,
          service: plan.service,
          amount: plan.price,
        },
        provider: fulfilled.provider,
      });
    } catch (error) {
      try {
        await cancelUpstream({
          provider: fulfilled.provider,
          providerRequestId: fulfilled.providerRequestId,
          service: plan.service,
        });
      } catch (cancelError) {
        console.error("Upstream cancel failed", cancelError);
      }
      await db.delete(orders).where(eq(orders.id, orderId));

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
      throw error;
    }
  } catch {
    return Response.json(
      { ok: false, error: "We couldn't complete that order. Please try again." },
      { status: 500 },
    );
  }
}
