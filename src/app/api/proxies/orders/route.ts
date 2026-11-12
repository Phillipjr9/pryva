import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/identity/auth";
import { db } from "@/db";
import { orders, proxySlots } from "@/db/schema";
import { financialActionsUnavailable } from "@/lib/platform/financial-environment";

export const dynamic = "force-dynamic";
export async function GET() {
  const user = await requireAuthApi();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (financialActionsUnavailable()) return NextResponse.json({ error: "Proxy orders are unavailable in this environment." }, { status: 503 });
  const rows = await db.select({ id: proxySlots.id, country: proxySlots.country, state: proxySlots.state, proxyType: proxySlots.proxyType, status: proxySlots.status, expiresAt: proxySlots.expiresAt, createdAt: proxySlots.createdAt, orderId: orders.id, reference: orders.reference })
    .from(proxySlots).innerJoin(orders, eq(proxySlots.orderId, orders.id))
    .where(and(eq(orders.userId, user.id), eq(orders.service, "proxies")))
    .orderBy(desc(proxySlots.createdAt)).limit(100);
  return NextResponse.json({ ok: true, slots: rows }, { headers: { "Cache-Control": "private, no-store" } });
}
