import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { desc, count } from "drizzle-orm";
import { requireAdminApi } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const admin = await requireAdminApi();
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  try {


    const limit = parseInt(request.nextUrl.searchParams.get("limit") || "50");
    const offset = parseInt(request.nextUrl.searchParams.get("offset") || "0");
    const status = request.nextUrl.searchParams.get("status");

    let query = db.query.orders.findMany({
      orderBy: [desc(orders.createdAt)],
      limit,
      offset,
    });

    if (status) {
      query = db.query.orders.findMany({
        where: (orders, { eq }) => eq(orders.status, status),
        orderBy: [desc(orders.createdAt)],
        limit,
        offset,
      });
    }

    const allOrders = await query;
    const [total] = await db.select({ count: count() }).from(orders);

    return NextResponse.json({
      ok: true,
      orders: allOrders.map((o) => ({
        id: o.id,
        reference: o.reference,
        userId: o.userId,
        service: o.service,
        productName: o.productName,
        amount: o.amount,
        status: o.status,
        createdAt: o.createdAt.toISOString(),
      })),
      total: total?.count || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Failed to fetch orders:", error);
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }
}
