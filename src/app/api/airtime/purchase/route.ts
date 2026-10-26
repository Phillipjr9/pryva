import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, orders, walletTransactions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { findDataPlan } from "@/lib/airtime";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { planId, phoneNumber } = body;

    if (!planId || !phoneNumber) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const plan = findDataPlan(planId);
    if (!plan) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const currentUser = await db.query.users.findFirst({
      where: eq(users.id, user.id),
    });

    if (!currentUser || currentUser.walletBalance < plan.price) {
      return NextResponse.json({ error: "Insufficient wallet balance" }, { status: 400 });
    }

    await db.transaction(async (tx) => {
      const newBalance = currentUser.walletBalance - plan.price;

      await tx.update(users).set({ walletBalance: newBalance }).where(eq(users.id, user.id));

      const reference = `DATA-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

      const [order] = await tx
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
          referenceCode: phoneNumber,
        })
        .returning();

      await tx.insert(walletTransactions).values({
        userId: user.id,
        orderId: order.id,
        type: "debit",
        amount: plan.price,
        balanceAfter: newBalance,
        description: `Data purchase: ${plan.name} for ${phoneNumber}`,
        reference,
      });
    });

    return NextResponse.json({
      ok: true,
      message: `Data plan purchased successfully for ${phoneNumber}`,
    });
  } catch (error) {
    console.error("Data purchase failed:", error);
    const message = error instanceof Error ? error.message : "Purchase failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
