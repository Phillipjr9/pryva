import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/identity/auth";
import { db } from "@/db";
import { orders, proxySlots } from "@/db/schema";
import { financialActionsUnavailable } from "@/lib/platform/financial-environment";
import { revealFleexaProxy } from "@/lib/providers/fleexa";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Context = { params: Promise<{ id: string }> };
export async function POST(_request: Request, { params }: Context) {
  const user = await requireAuthApi();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (financialActionsUnavailable()) return NextResponse.json({ error: "Proxy credentials are unavailable in this environment." }, { status: 503 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Proxy slot not found." }, { status: 404 });
  const [slot] = await db.select({ slot: proxySlots }).from(proxySlots).innerJoin(orders, eq(proxySlots.orderId, orders.id))
    .where(and(eq(proxySlots.id, id), eq(orders.userId, user.id), eq(orders.service, "proxies"))).limit(1);
  if (!slot) return NextResponse.json({ error: "Proxy slot not found." }, { status: 404 });
  if (slot.slot.status !== "active") return NextResponse.json({ error: "Credentials are available only for an active, extracted slot." }, { status: 409 });
  try {
    const proxy = await revealFleexaProxy(slot.slot.providerSlotId, { country: slot.slot.country, proxyType: slot.slot.proxyType });
    await db.update(proxySlots).set({ status: "active", expiresAt: proxy.expiresAt ? new Date(proxy.expiresAt) : slot.slot.expiresAt }).where(eq(proxySlots.id, id));
    return NextResponse.json({ ok: true, slot: { id, status: "active", expiresAt: proxy.expiresAt, credentials: proxy.credentials } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Credentials could not be revealed for this active slot." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
