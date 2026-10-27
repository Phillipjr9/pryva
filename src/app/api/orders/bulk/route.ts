import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, orders, walletTransactions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { calculateBulkOrder, type BulkOrderItem } from "@/lib/bulk-orders";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { items } = body as { items: BulkOrderItem[] };

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Invalid items" }, { status: 400 });
    }

    const result = calculateBulkOrder(items);

    const currentUser = await db.query.users.findFirst({
      where: eq(users.id, user.id),
    });

    if (!currentUser || currentUser.walletBalance < result.total) {
      return NextResponse.json({ error: "Insufficient wallet balance" }, { status: 400 });
    }

    await db.transaction(async (tx) => {
      const newBalance = currentUser.walletBalance - result.total;

      await tx.update(users).set({ walletBalance: newBalance }).where(eq(users.id, user.id));

      for (const item of result.items) {
        for (let i = 0; i < item.quantity; i++) {
          const reference = `BULK-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

          const [order] = await tx
            .insert(orders)
            .values({
              reference,
              userId: user.id,
              service: "bulk",
              productSlug: item.productSlug,
              productName: item.productName,
              planLabel: `Bulk order (${result.discountPercent}% off)`,
              region: "Nigeria",
              duration: "Bulk purchase",
              amount: item.unitPrice,
              status: "delivered",
              provider: "bulk",
            })
            .returning();

          await tx.insert(walletTransactions).values({
            userId: user.id,
            orderId: order.id,
            type: "debit",
            amount: item.unitPrice,
            balanceAfter: newBalance,
            description: `Bulk purchase: ${item.productName} (${result.discountPercent}% discount)`,
            reference,
          });
        }
      }
    });

    return NextResponse.json({
      ok: true,
      subtotal: result.subtotal,
      discount: result.discount,
      discountPercent: result.discountPercent,
      total: result.total,
    });
  } catch (error) {
    console.error("Bulk order failed:", error);
    const message = error instanceof Error ? error.message : "Order failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
