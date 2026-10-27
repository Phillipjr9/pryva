import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders, walletTransactions, giftCards } from "@/db/schema";
import { eq, and, or, ilike } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// GET /api/search - Search user's orders, transactions, and gift cards
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = request.nextUrl;
    const query = searchParams.get("q")?.trim();
    const type = searchParams.get("type"); // orders, transactions, gift-cards, all

    if (!query || query.length < 2) {
      return NextResponse.json({ error: "Search query must be at least 2 characters" }, { status: 400 });
    }

    const searchQuery = `%${query}%`;
    const results: Record<string, unknown[]> = {};

    // Search orders
    if (!type || type === "all" || type === "orders") {
      const userOrders = await db
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.userId, user.id),
            or(
              ilike(orders.productName, searchQuery),
              ilike(orders.reference, searchQuery),
              ilike(orders.service, searchQuery),
              ilike(orders.region, searchQuery)
            )
          )
        )
        .limit(20);

      results.orders = userOrders.map((o) => ({
        id: o.id,
        reference: o.reference,
        productName: o.productName,
        service: o.service,
        region: o.region,
        amount: o.amount,
        status: o.status,
        createdAt: o.createdAt,
      }));
    }

    // Search transactions
    if (!type || type === "all" || type === "transactions") {
      const userTransactions = await db
        .select()
        .from(walletTransactions)
        .where(
          and(
            eq(walletTransactions.userId, user.id),
            or(
              ilike(walletTransactions.description, searchQuery),
              ilike(walletTransactions.reference, searchQuery),
              ilike(walletTransactions.type, searchQuery)
            )
          )
        )
        .limit(20);

      results.transactions = userTransactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        description: t.description,
        reference: t.reference,
        createdAt: t.createdAt,
      }));
    }

    // Search gift cards
    if (!type || type === "all" || type === "gift-cards") {
      const userGiftCards = await db
        .select()
        .from(giftCards)
        .where(
          and(
            or(
              eq(giftCards.purchasedBy, user.id),
              eq(giftCards.redeemedBy, user.id)
            ),
            or(
              ilike(giftCards.code, searchQuery),
              ilike(giftCards.recipientEmail, searchQuery),
              ilike(giftCards.message, searchQuery)
            )
          )
        )
        .limit(20);

      results.giftCards = userGiftCards.map((g) => ({
        id: g.id,
        code: g.code,
        amount: g.amount,
        status: g.status,
        recipientEmail: g.recipientEmail,
        createdAt: g.createdAt,
      }));
    }

    const totalResults = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);

    logger.info("Search performed", { userId: user.id, query, totalResults });

    return NextResponse.json({
      ok: true,
      query,
      results,
      totalResults,
    });
  } catch (error) {
    logger.error("Search failed", { error });
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
