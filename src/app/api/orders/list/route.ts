import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuthApi } from "@/lib/identity/auth";
import { accountReadRateLimiter, rateLimitRefusal } from "@/lib/platform/rate-limit";

export const dynamic = "force-dynamic";

/*
 * The order list is the customer's main history read and the obvious thing for a
 * client to poll. It is bounded at 100 rows, so it is not dangerous per request
 * — but an account holding a session and a loop is the cheapest way to keep the
 * database busy without ever touching a money path or a purchase limiter.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const throttle = await accountReadRateLimiter(`orders-list:${user.id}`);
    const refused = rateLimitRefusal(throttle, "You are loading orders too quickly. Please wait a moment.");
    if (refused) return refused;

    const limitText = request.nextUrl.searchParams.get("limit") ?? "50";
    const offsetText = request.nextUrl.searchParams.get("offset") ?? "0";
    if (!/^\d{1,5}$/.test(limitText) || !/^\d{1,5}$/.test(offsetText)) return NextResponse.json({ error: "Invalid pagination" }, { status: 400 });
    const limit = Number(limitText);
    const offset = Number(offsetText);
    const status = request.nextUrl.searchParams.get("status");
    if (limit < 1 || limit > 100 || offset > 10_000 || (status && !/^[a-z-]{1,24}$/i.test(status))) return NextResponse.json({ error: "Invalid query" }, { status: 400 });

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
