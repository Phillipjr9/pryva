import { authorizeAdminApi } from "@/lib/identity/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { desc, count, eq } from "drizzle-orm";
import { pageWindow } from "@/lib/platform/pagination";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const access = await authorizeAdminApi(request);
    if (access.response) return access.response;

    // Bounded: `?limit=` used to reach the database unchanged, so one request
    // could ask for the whole order history at once. See `pageWindow`.
    const { limit, offset } = pageWindow(request.nextUrl.searchParams);
    const status = request.nextUrl.searchParams.get("status");
    const where = status ? eq(orders.status, status) : undefined;

    // Only the columns this response sends. An order row also carries what was
    // delivered — codes, activation details — and none of that belongs in the
    // memory of a request that is only listing references and amounts.
    const allOrders = await db.query.orders.findMany({
      columns: {
        id: true,
        reference: true,
        userId: true,
        service: true,
        productName: true,
        amount: true,
        status: true,
        createdAt: true,
      },
      where,
      orderBy: [desc(orders.createdAt)],
      limit,
      offset,
    });

    // The total describes the same set the page was cut from. It used to count
    // every order whatever the filter, so a filtered list reported page counts
    // for rows it would never return.
    const totalQuery = db.select({ count: count() }).from(orders);
    const [total] = await (where ? totalQuery.where(where) : totalQuery);

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
