import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { getDigitalPlan } from "@/lib/digital-services";
import { debitWallet, InsufficientFundsError } from "@/lib/wallet";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { planId } = body;

    if (!planId) {
      return NextResponse.json({ error: "Plan ID required" }, { status: 400 });
    }

    const planInfo = getDigitalPlan(planId);
    if (!planInfo) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const { service, plan } = planInfo;

    // Check balance
    if (user.walletBalance < plan.price) {
      return NextResponse.json({
        error: `Insufficient balance. Need ${formatNaira(plan.price)}, have ${formatNaira(user.walletBalance)}`,
      }, { status: 400 });
    }

    // Create order
    const reference = `DIG-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    const [order] = await db
      .insert(orders)
      .values({
        reference,
        userId: user.id,
        service: "digital",
        productSlug: service.slug,
        productName: plan.name,
        planLabel: plan.duration,
        region: "Global",
        duration: plan.duration,
        amount: plan.price,
        status: "processing",
        provider: "manual",
      })
      .returning();

    // Debit wallet. If the balance can't cover it, remove the order row so a
    // stale "processing" order is never left behind.
    try {
      await debitWallet({
        userId: user.id,
        type: "debit",
        orderId: order.id,
        amount: plan.price,
        description: `${plan.name} purchase`,
        reference,
      });
    } catch (error) {
      await db.delete(orders).where(eq(orders.id, order.id));
      if (error instanceof InsufficientFundsError) {
        return NextResponse.json(
          { error: "Insufficient wallet balance.", balance: error.balance, required: error.required },
          { status: 402 },
        );
      }
      throw error;
    }

    logger.info("Digital service purchased", {
      userId: user.id,
      service: service.slug,
      plan: plan.id,
      amount: plan.price,
      reference,
    });

    // TODO: Integrate with account provider to fetch credentials
    // For now, mark as delivered with placeholder
    await db
      .update(orders)
      .set({
        status: "delivered",
        referenceCode: `Account credentials will be sent to your email within 5 minutes. Order: ${reference}`,
      })
      .where(eq(orders.id, order.id));

    return NextResponse.json({
      ok: true,
      message: "Purchase successful! Check your email for account credentials.",
      order: {
        id: order.id,
        reference: order.reference,
        productName: plan.name,
        amount: plan.price,
      },
    });
  } catch (error) {
    logger.error("Digital service purchase failed", { error });
    const message = error instanceof Error ? error.message : "Purchase failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function formatNaira(amount: number): string {
  return `₦${amount.toLocaleString()}`;
}
