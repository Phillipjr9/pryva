import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { getDigitalPlan } from "@/lib/digital-services";
import { debitWallet } from "@/lib/wallet";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { logger } from "@/lib/logger";
import { isPreviewDatabase } from "@/lib/demo-policy";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // No account provider is connected yet. Never debit a real wallet for a
    // placeholder delivery; the flow is available only with preview data.
    if (!isPreviewDatabase()) {
      return NextResponse.json({ error: "Digital purchases are temporarily unavailable." }, { status: 503 });
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

    // Debit wallet
    await debitWallet({
      userId: user.id,
      orderId: order.id,
      amount: plan.price,
      type: "debit",
      description: `${plan.name} purchase`,
      reference,
    });

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
