import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { requireAuthApi } from "@/lib/identity/auth";
import { financialActionsUnavailable } from "@/lib/platform/financial-environment";
import { createRateLimiter } from "@/lib/platform/rate-limit";
import { syncTelegramStars } from "@/lib/services/foxreload/stars-orders";
export const dynamic = "force-dynamic";
const limiter = createRateLimiter({ windowMs: 20_000, maxRequests: 1 });
export async function GET(request: Request) {
  const user = await requireAuthApi();
  if (!user) return Response.json({ ok: false, error: "Please sign in." }, { status: 401 });
  if (financialActionsUnavailable()) return Response.json({ ok: false, error: "Sync is unavailable in this environment." }, { status: 503 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return Response.json({ ok: false, error: "Order not found." }, { status: 404 });
  const [existing] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.id, id), eq(orders.userId, user.id), eq(orders.service, "subscriptions"), eq(orders.productSlug, "telegram-stars"))).limit(1);
  if (!existing) return Response.json({ ok: false, error: "Order not found." }, { status: 404 });
  const allowed = await limiter(`stars-sync:${user.id}:${id}`);
  if (allowed.unavailable) return Response.json({ ok: false, error: "Sync temporarily unavailable." }, { status: 503 });
  if (!allowed.allowed) return Response.json({ ok: false, error: "Try again shortly." }, { status: 429 });
  try { await syncTelegramStars(id, user.id); } catch { /* No news is not a failure or refund. */ }
  const [order] = await db.select({ id: orders.id, status: orders.status, reference: orders.reference }).from(orders).where(and(eq(orders.id, id), eq(orders.userId, user.id))).limit(1);
  return Response.json({ ok: true, order }, { headers: { "Cache-Control": "private, no-store" } });
}
