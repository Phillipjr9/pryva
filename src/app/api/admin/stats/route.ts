import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, orders, walletTransactions } from "@/db/schema";
import { and, count, sum, eq, gte } from "drizzle-orm";
import { requireAdminApi } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const admin = await requireAdminApi();
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  try {


    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Total stats
    const [totalUsers] = await db.select({ count: count() }).from(users);
    const [totalOrders] = await db.select({ count: count() }).from(orders);
    const [totalRevenue] = await db
      .select({ sum: sum(orders.amount) })
      .from(orders)
      .where(eq(orders.status, "delivered"));

    // Last 24h stats
    const [users24h] = await db
      .select({ count: count() })
      .from(users)
      .where(gte(users.createdAt, last24h));
    const [orders24h] = await db
      .select({ count: count() })
      .from(orders)
      .where(gte(orders.createdAt, last24h));
    const [revenue24h] = await db
      .select({ sum: sum(orders.amount) })
      .from(orders)
      .where(and(eq(orders.status, "delivered"), gte(orders.createdAt, last24h)));

    // Last 7d stats
    const [orders7d] = await db
      .select({ count: count() })
      .from(orders)
      .where(gte(orders.createdAt, last7d));

    // Last 30d stats
    const [orders30d] = await db
      .select({ count: count() })
      .from(orders)
      .where(gte(orders.createdAt, last30d));

    return NextResponse.json({
      ok: true,
      stats: {
        total: {
          users: totalUsers?.count || 0,
          orders: totalOrders?.count || 0,
          revenue: totalRevenue?.sum || 0,
        },
        last24h: {
          users: users24h?.count || 0,
          orders: orders24h?.count || 0,
          revenue: revenue24h?.sum || 0,
        },
        last7d: {
          orders: orders7d?.count || 0,
        },
        last30d: {
          orders: orders30d?.count || 0,
        },
      },
    });
  } catch (error) {
    console.error("Failed to fetch stats:", error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
