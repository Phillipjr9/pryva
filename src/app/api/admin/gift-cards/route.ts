import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { giftCards } from "@/db/schema";
import { desc, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// GET /api/admin/gift-cards - List all gift cards
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50")));
    const offset = (page - 1) * limit;
    const status = searchParams.get("status");

    let query = db.select().from(giftCards).orderBy(desc(giftCards.createdAt));

    if (status) {
      query = query.where(sql`${giftCards.status} = ${status}`) as typeof query;
    }

    const cards = await query.limit(limit).offset(offset);

    const countResult = await db.select({ count: sql<number>`count(*)` }).from(giftCards);
    const total = Number(countResult[0]?.count || 0);

    return NextResponse.json({
      ok: true,
      giftCards: cards.map((c) => ({
        id: c.id,
        code: c.code,
        amount: c.amount,
        initialAmount: c.initialAmount,
        purchasedBy: c.purchasedBy,
        redeemedBy: c.redeemedBy,
        recipientEmail: c.recipientEmail,
        message: c.message,
        status: c.status,
        expiresAt: c.expiresAt,
        redeemedAt: c.redeemedAt,
        createdAt: c.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error("Failed to fetch admin gift cards", { error });
    return NextResponse.json({ error: "Failed to fetch gift cards" }, { status: 500 });
  }
}
