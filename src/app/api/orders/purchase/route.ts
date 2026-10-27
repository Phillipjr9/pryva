import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders, walletTransactions, users } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { findPlan } from "@/lib/catalog";
import { fulfillOrder } from "@/lib/fulfillment";
import { logger } from "@/lib/logger";
import { InsufficientFundsError } from "@/lib/wallet";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { planSlug } = body;

    if (!planSlug) {
      return NextResponse.json({ error: "Plan slug required" }, { status: 400 });
    }

    const plan = findPlan(planSlug);
    if (!plan) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const currentUser = await db.query.users.findFirst({
      where: eq(users.id, user.id),
    });

    if (!currentUser || currentUser.walletBalance < plan.price) {
      return NextResponse.json({ error: "Insufficient wallet balance" }, { status: 400 });
    }

    let orderId: string | undefined;

    await db.transaction(async (tx) => {
      const reference = `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

      // Atomic debit: the WHERE clause carries the balance guard, so two
      // concurrent purchases can never spend the same Naira twice.
      const [debited] = await tx
        .update(users)
        .set({ walletBalance: sql`${users.walletBalance} - ${plan.price}` })
        .where(and(eq(users.id, user.id), gte(users.walletBalance, plan.price)))
        .returning({ balance: users.walletBalance });

      if (!debited) {
        throw new InsufficientFundsError(currentUser.walletBalance, plan.price);
      }

      const newBalance = debited.balance;

      const [order] = await tx
        .insert(orders)
        .values({
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
          provider: "pending",
        })
        .returning();

      orderId = order.id;

      await tx.insert(walletTransactions).values({
        userId: user.id,
        orderId: order.id,
        type: "debit",
        amount: plan.price,
        balanceAfter: newBalance,
        description: `Purchase: ${plan.name}`,
        reference,
      });
    });

    if (!orderId) {
      return NextResponse.json({ error: "Could not create your order. Nothing was charged." }, { status: 500 });
    }

    logger.info("Order created successfully", { orderId, userId: user.id, planSlug });

    // Trigger fulfillment asynchronously
    fulfillOrder(orderId).catch((error) => {
      logger.error("Order fulfillment failed", { orderId, error });
    });

    return NextResponse.json({
      ok: true,
      orderId,
      message: "Order created successfully. Fulfillment in progress.",
    });
  } catch (error) {
    logger.error("Order purchase failed", { error });
    const message = error instanceof Error ? error.message : "Purchase failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
