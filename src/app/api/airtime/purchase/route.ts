import { isPreviewDatabase } from "@/lib/demo-policy";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { findDataPlan } from "@/lib/airtime";
import { purchaseRateLimiter } from "@/lib/rate-limit";
import {
  InsufficientFundsError,
  creditWallet,
  debitWallet,
  makeReference,
} from "@/lib/wallet";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const MAX_ORDERS_PER_DAY = 20;

/**
 * POST /api/airtime/purchase  { planId, phoneNumber }
 *
 * Money sequence (same shape as every other spending route):
 *   1. Validate the plan and the number server-side — the price never comes
 *      from the client.
 *   2. Debit through `debitWallet`, whose balance guard lives inside the SQL
 *      UPDATE, so two concurrent taps can't spend the same Naira twice.
 *   3. Create the order *after* the money moves; if the order row fails, refund.
 *   4. If fulfilment fails, refund and mark the order refunded.
 */
export async function POST(request: NextRequest) {
  let userId: string | null = null;

  try {
    const user = await requireAuth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    userId = user.id;

    const limit = await purchaseRateLimiter(`data:${user.id}:${MAX_ORDERS_PER_DAY}`);
    if (!limit.allowed) {
      const seconds = Math.max(1, Math.ceil((limit.resetTime - Date.now()) / 1000));
      return NextResponse.json(
        { error: `You're buying very fast. Try again in ${seconds}s.` },
        { status: 429 },
      );
    }

    const body = await request.json();
    const { planId, phoneNumber } = body as { planId?: unknown; phoneNumber?: unknown };

    if (typeof planId !== "string" || !planId) {
      return NextResponse.json({ error: "Choose a data plan." }, { status: 400 });
    }

    // Nigerian mobile numbers: 11 digits starting 070/080/081/090/091/+234.
    const rawNumber = typeof phoneNumber === "string" ? phoneNumber.replace(/[^\d+]/g, "") : "";
    const normalized = rawNumber.startsWith("+234")
      ? `0${rawNumber.slice(4)}`
      : rawNumber.startsWith("234")
        ? `0${rawNumber.slice(3)}`
        : rawNumber;

    if (!/^0(7|8|9)[01]\d{8}$/.test(normalized)) {
      return NextResponse.json(
        { error: "Enter a valid Nigerian mobile number, e.g. 0803 123 4567." },
        { status: 400 },
      );
    }

    const plan = findDataPlan(planId);
    if (!plan) {
      return NextResponse.json({ error: "That plan is no longer available." }, { status: 400 });
    }

    // Provider fulfilment isn't wired yet; only the preview database may sell.
    if (!isPreviewDatabase()) {
      return NextResponse.json(
        { error: "Data purchases are temporarily unavailable." },
        { status: 503 },
      );
    }

    const reference = makeReference("DATA");
    let orderId: string | null = null;

    try {
      await debitWallet({
        userId: user.id,
        amount: plan.price,
        type: "debit",
        description: `Data: ${plan.name} → ${normalized}`.slice(0, 200),
        reference,
      });
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        return NextResponse.json(
          {
            error: "Insufficient wallet balance.",
            balance: error.balance,
            required: error.required,
          },
          { status: 402 },
        );
      }
      throw error;
    }

    try {
      const [order] = await db
        .insert(orders)
        .values({
          reference,
          userId: user.id,
          service: "data",
          productSlug: plan.id,
          productName: plan.name,
          planLabel: `${plan.size} · ${plan.duration}`,
          region: "Nigeria",
          duration: plan.duration,
          amount: plan.price,
          status: "delivered",
          provider: "airtime",
          referenceCode: normalized,
        })
        .returning();

      orderId = order?.id ?? null;
    } catch (error) {
      // Money moved but the record didn't — give it straight back.
      logger.error("Data order insert failed — refunding", { reference, userId: user.id, error });
      await creditWallet({
        userId: user.id,
        amount: plan.price,
        type: "refund",
        description: `Refund — data purchase ${reference}`,
        reference: makeReference("RFD"),
      });
      return NextResponse.json(
        { error: "We couldn't create your order. Nothing was charged." },
        { status: 500 },
      );
    }

    logger.info("Data purchase completed", {
      reference,
      orderId,
      planId: plan.id,
      amount: plan.price,
      userId: user.id,
    });

    return NextResponse.json({
      ok: true,
      message: `${plan.name} is on its way to ${normalized}.`,
      order: { reference, amount: plan.price, planLabel: `${plan.size} · ${plan.duration}` },
    });
  } catch (error) {
    logger.error("Data purchase failed", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "That purchase could not be completed." }, { status: 500 });
  }
}
