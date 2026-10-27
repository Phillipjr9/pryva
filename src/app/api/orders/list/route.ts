import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuthApi } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limit = parseInt(request.nextUrl.searchParams.get("limit") || "50");
    const offset = parseInt(request.nextUrl.searchParams.get("offset") || "0");
    const status = request.nextUrl.searchParams.get("status");

    let query = db.query.orders.findMany({
      where: eq(orders.userId, user.id),
      orderBy: [desc(orders.createdAt)],
      limit,
      offset,
    });

    if (status) {
      query = db.query.orders.findMany({
        where: (orders, { and, eq }) => and(eq(orders.userId, user.id), eq(orders.status, status)),
        orderBy: [desc(orders.createdAt)],
        limit,
        offset,
      });
    }

    const userOrders = await query;

    return NextResponse.json({
      ok: true,
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
        referenceCode: o.referenceCode,
        otpCode: o.otpCode,
        expiresAt: o.expiresAt?.toISOString() || null,
        createdAt: o.createdAt.toISOString(),
      })),
      limit,
      offset,
    });
  } catch (error) {
    console.error("Failed to fetch orders:", error);
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }
}
