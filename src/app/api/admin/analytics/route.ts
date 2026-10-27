import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, orders, walletTransactions, giftCards } from "@/db/schema";
import { sql, gte, and, eq } from "drizzle-orm";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// GET /api/admin/analytics - Comprehensive analytics dashboard
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const period = searchParams.get("period") || "30d"; // 7d, 30d, 90d, 1y

    const daysMap: Record<string, number> = {
      "7d": 7,
      "30d": 30,
      "90d": 90,
      "1y": 365,
    };

    const days = daysMap[period] || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Revenue analytics
    const revenueResult = await db
      .select({
        total: sql<number>`COALESCE(SUM(${orders.amount}), 0)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(orders)
      .where(gte(orders.createdAt, startDate));

    const revenue = {
      total: Number(revenueResult[0]?.total || 0),
      orders: Number(revenueResult[0]?.count || 0),
      average: revenueResult[0]?.count ? Number(revenueResult[0].total) / Number(revenueResult[0].count) : 0,
    };

    // User growth
    const newUsers = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(users)
      .where(gte(users.createdAt, startDate));

    // Order status breakdown
    const orderStatuses = await db
      .select({
        status: orders.status,
        count: sql<number>`COUNT(*)`,
      })
      .from(orders)
      .where(gte(orders.createdAt, startDate))
      .groupBy(orders.status);

    // Service breakdown
    const serviceBreakdown = await db
      .select({
        service: orders.service,
        count: sql<number>`COUNT(*)`,
        revenue: sql<number>`COALESCE(SUM(${orders.amount}), 0)`,
      })
      .from(orders)
      .where(gte(orders.createdAt, startDate))
      .groupBy(orders.service);

    // Daily revenue trend (last 30 days)
    const dailyTrend = await db
      .select({
        date: sql<string>`DATE(${orders.createdAt})`,
        revenue: sql<number>`COALESCE(SUM(${orders.amount}), 0)`,
        orders: sql<number>`COUNT(*)`,
      })
      .from(orders)
      .where(gte(orders.createdAt, startDate))
      .groupBy(sql`DATE(${orders.createdAt})`)
      .orderBy(sql`DATE(${orders.createdAt})`);

    // Top products
    const topProducts = await db
      .select({
        productName: orders.productName,
        count: sql<number>`COUNT(*)`,
        revenue: sql<number>`COALESCE(SUM(${orders.amount}), 0)`,
      })
      .from(orders)
      .where(gte(orders.createdAt, startDate))
      .groupBy(orders.productName)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(10);

    // Wallet activity
    const walletActivity = await db
      .select({
        type: walletTransactions.type,
        count: sql<number>`COUNT(*)`,
        total: sql<number>`COALESCE(SUM(${walletTransactions.amount}), 0)`,
      })
      .from(walletTransactions)
      .where(gte(walletTransactions.createdAt, startDate))
      .groupBy(walletTransactions.type);

    // Gift card stats
    const giftCardStats = await db
      .select({
        total: sql<number>`COUNT(*)`,
        active: sql<number>`COUNT(*) FILTER (WHERE ${giftCards.status} = 'active')`,
        redeemed: sql<number>`COUNT(*) FILTER (WHERE ${giftCards.status} = 'redeemed')`,
        totalValue: sql<number>`COALESCE(SUM(${giftCards.initialAmount}), 0)`,
      })
      .from(giftCards)
      .where(gte(giftCards.createdAt, startDate));

    return NextResponse.json({
      ok: true,
      period,
      days,
      analytics: {
        revenue,
        users: {
          new: Number(newUsers[0]?.count || 0),
        },
        orders: {
          byStatus: orderStatuses.map((s) => ({
            status: s.status,
            count: Number(s.count),
          })),
          byService: serviceBreakdown.map((s) => ({
            service: s.service,
            count: Number(s.count),
            revenue: Number(s.revenue),
          })),
          dailyTrend: dailyTrend.map((d) => ({
            date: d.date,
            revenue: Number(d.revenue),
            orders: Number(d.orders),
          })),
          topProducts: topProducts.map((p) => ({
            name: p.productName,
            count: Number(p.count),
            revenue: Number(p.revenue),
          })),
        },
        wallet: walletActivity.map((w) => ({
          type: w.type,
          count: Number(w.count),
          total: Number(w.total),
        })),
        giftCards: {
          total: Number(giftCardStats[0]?.total || 0),
          active: Number(giftCardStats[0]?.active || 0),
          redeemed: Number(giftCardStats[0]?.redeemed || 0),
          totalValue: Number(giftCardStats[0]?.totalValue || 0),
        },
      },
    });
  } catch (error) {
    logger.error("Failed to fetch analytics", { error });
    return NextResponse.json({ error: "Failed to fetch analytics" }, { status: 500 });
  }
}
