import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, orders, walletTransactions, giftCards, scheduledOrders } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// GET /api/user/export - Export user data (GDPR compliance)
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    logger.info("User data export requested", { userId: user.id });

    // Fetch all user data
    const userData = await db.query.users.findFirst({
      where: eq(users.id, user.id),
    });

    const userOrders = await db.query.orders.findMany({
      where: eq(orders.userId, user.id),
    });

    const userTransactions = await db.query.walletTransactions.findMany({
      where: eq(walletTransactions.userId, user.id),
    });

    const userGiftCards = await db.query.giftCards.findMany({
      where: eq(giftCards.purchasedBy, user.id),
    });

    const redeemedGiftCards = await db.query.giftCards.findMany({
      where: eq(giftCards.redeemedBy, user.id),
    });

    const userScheduledOrders = await db.query.scheduledOrders.findMany({
      where: eq(scheduledOrders.userId, user.id),
    });

    // Format export data
    const exportData = {
      exportDate: new Date().toISOString(),
      user: {
        id: userData?.id,
        name: userData?.name,
        email: userData?.email,
        walletBalance: userData?.walletBalance,
        createdAt: userData?.createdAt,
      },
      orders: userOrders.map((o) => ({
        id: o.id,
        reference: o.reference,
        service: o.service,
        productName: o.productName,
        planLabel: o.planLabel,
        region: o.region,
        duration: o.duration,
        amount: o.amount,
        status: o.status,
        createdAt: o.createdAt,
        expiresAt: o.expiresAt,
      })),
      transactions: userTransactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        balanceAfter: t.balanceAfter,
        description: t.description,
        reference: t.reference,
        createdAt: t.createdAt,
      })),
      giftCards: {
        purchased: userGiftCards.map((g) => ({
          id: g.id,
          code: g.code,
          amount: g.amount,
          initialAmount: g.initialAmount,
          status: g.status,
          recipientEmail: g.recipientEmail,
          message: g.message,
          createdAt: g.createdAt,
          redeemedAt: g.redeemedAt,
        })),
        redeemed: redeemedGiftCards.map((g) => ({
          id: g.id,
          code: g.code,
          amount: g.amount,
          redeemedAt: g.redeemedAt,
        })),
      },
      scheduledOrders: userScheduledOrders.map((s) => ({
        id: s.id,
        service: s.service,
        productSlug: s.productSlug,
        frequency: s.frequency,
        status: s.status,
        nextRunAt: s.nextRunAt,
        lastRunAt: s.lastRunAt,
        createdAt: s.createdAt,
      })),
    };

    // Return as downloadable JSON
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });

    return new NextResponse(blob, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="pryva-data-export-${new Date().toISOString().split("T")[0]}.json"`,
      },
    });
  } catch (error) {
    logger.error("Failed to export user data", { error });
    return NextResponse.json({ error: "Failed to export data" }, { status: 500 });
  }
}
