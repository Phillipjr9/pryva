import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuthApi } from "@/lib/auth";
import { getDigitalPlan } from "@/lib/digital-services";
import { debitWallet, makeReference, InsufficientFundsError } from "@/lib/wallet";
import { isSameOriginMutation } from "@/lib/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { purchaseRateLimiter } from "@/lib/rate-limit";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { logger } from "@/lib/logger";
import { isPreviewDatabase } from "@/lib/demo-policy";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
    // No account provider is connected yet. Never debit a real wallet for a
    // placeholder delivery; the flow is available only with preview data.
    if (!isPreviewDatabase()) {
      return NextResponse.json({ error: "Digital purchases are temporarily unavailable." }, { status: 503 });
    }
    const limit = await purchaseRateLimiter(`digital:${user.id}`);
    if (limit.unavailable) return NextResponse.json({ error: "Purchases are temporarily unavailable." }, { status: 503 });
    if (!limit.allowed) return NextResponse.json({ error: "Too many purchase attempts. Try again later." }, { status: 429 });

    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 2_048);
    } catch (error) {
      return NextResponse.json({ error: "Invalid request" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    const planId = body && typeof body === "object" && !Array.isArray(body) ? (body as { planId?: unknown }).planId : null;

    if (typeof planId !== "string" || !planId || planId.length > 100) {
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
    const reference = makeReference("DIG");

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
        provider: "simulated",
      })
      .returning();

    // Preview storage has no rollback; only remove the placeholder when no
    // debit was made. Keep it for inspection on an unexpected partial failure.
    try {
      await debitWallet({
        userId: user.id,
        orderId: order.id,
        amount: plan.price,
        type: "debit",
        description: `${plan.name} purchase`,
        reference,
      });
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        await db.delete(orders).where(eq(orders.id, order.id));
        return NextResponse.json({ error: "Insufficient wallet balance." }, { status: 402 });
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

    // This is explicitly a simulated delivery, not working credentials.
    await db
      .update(orders)
      .set({
        status: "delivered",
        referenceCode: `Simulated preview only; no credentials were delivered. Order: ${reference}`,
      })
      .where(eq(orders.id, order.id));

    return NextResponse.json({
      ok: true,
      message: "Simulated preview order complete. No working credentials will be sent.",
      order: {
        id: order.id,
        reference: order.reference,
        productName: plan.name,
        amount: plan.price,
      },
    });
  } catch {
    logger.error("Digital service purchase failed");
    return NextResponse.json({ error: "Purchase could not be completed." }, { status: 500 });
  }
}

function formatNaira(amount: number): string {
  return `₦${amount.toLocaleString()}`;
}
