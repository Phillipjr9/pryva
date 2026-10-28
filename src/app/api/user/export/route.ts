import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, orders, walletTransactions, giftCards, scheduledOrders } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAuthApi } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { userExportRateLimiter } from "@/lib/rate-limit";

const MAX_EXPORT_ROWS_PER_CATEGORY = 5_000;

export const dynamic = "force-dynamic";

// GET /api/user/export - Download selected account activity; not a complete privacy-access export.
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limit = await userExportRateLimiter(`user-export:${user.id}`);
    if (limit.unavailable) return NextResponse.json({ error: "Export is temporarily unavailable" }, { status: 503 });
    if (!limit.allowed) return NextResponse.json({ error: "Too many export requests. Try again later." }, { status: 429 });
    logger.info("User data export requested", { userId: user.id });

    // Fetch all user data
    const userData = await db.query.users.findFirst({
      where: eq(users.id, user.id),
    });

    const userOrders = await db.query.orders.findMany({
      where: eq(orders.userId, user.id),
      limit: MAX_EXPORT_ROWS_PER_CATEGORY + 1,
    });

    const userTransactions = await db.query.walletTransactions.findMany({
      where: eq(walletTransactions.userId, user.id),
      limit: MAX_EXPORT_ROWS_PER_CATEGORY + 1,
    });

    const userGiftCards = await db.query.giftCards.findMany({
      where: eq(giftCards.purchasedBy, user.id),
      limit: MAX_EXPORT_ROWS_PER_CATEGORY + 1,
    });

    const redeemedGiftCards = await db.query.giftCards.findMany({
      where: eq(giftCards.redeemedBy, user.id),
      limit: MAX_EXPORT_ROWS_PER_CATEGORY + 1,
    });

    const userScheduledOrders = await db.query.scheduledOrders.findMany({
      where: eq(scheduledOrders.userId, user.id),
      limit: MAX_EXPORT_ROWS_PER_CATEGORY + 1,
    });

    if ([userOrders, userTransactions, userGiftCards, redeemedGiftCards, userScheduledOrders].some((rows) => rows.length > MAX_EXPORT_ROWS_PER_CATEGORY)) {
      return NextResponse.json({ error: "This export is too large. Contact support for a complete data request." }, { status: 413 });
    }

    // Format export data
    const exportData = {
      exportDate: new Date().toISOString(),
      scope: "Selected account activity only; contact support for a complete personal-data request. This file may contain redeemable gift-card codes.",
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
    if (Buffer.byteLength(jsonString, "utf8") > 10_000_000) {
      return NextResponse.json({ error: "This export is too large. Contact support for a complete data request." }, { status: 413 });
    }
    const blob = new Blob([jsonString], { type: "application/json" });

    return new NextResponse(blob, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="pryva-data-export-${new Date().toISOString().split("T")[0]}.json"`,
      },
    });
  } catch (error) {
    logger.error("Failed to export user data", { error });
    return NextResponse.json({ error: "Failed to export data" }, { status: 500 });
  }
}
