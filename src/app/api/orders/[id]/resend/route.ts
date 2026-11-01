import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/net";
import { canResendNumberCode, resendNumberCode } from "@/lib/otp-resend";
import { createRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * A resend is a supplier call that costs us money when it succeeds, and the
 * supplier has its own cooldown. Two per minute per order is enough for a
 * customer whose code went astray and far too few for anyone hammering it.
 */
const resendLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2 });

/**
 * POST /api/orders/:id/resend
 *
 * Re-deliver the verification code to the number on an order that has not
 * delivered one yet. Scoped to the signed-in owner, and only where the supplier
 * actually supports it — the capability is decided here, not in the browser.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Please sign in first." }, { status: 401 });
  if (!isSameOriginMutation(request)) {
    return Response.json({ ok: false, error: "Cross-origin request denied." }, { status: 403 });
  }

  const { id } = await params;
  const limit = await resendLimiter(`resend:${user.id}:${id}`);
  if (limit.unavailable) {
    return Response.json({ ok: false, error: "Resending is temporarily unavailable." }, { status: 503 });
  }
  if (!limit.allowed) {
    return Response.json({ ok: false, error: "Give it a minute, then try again." }, { status: 429 });
  }

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, id), eq(orders.userId, user.id)))
    .limit(1);

  if (!order) return Response.json({ ok: false, error: "We couldn't find that order." }, { status: 404 });
  if (!canResendNumberCode(order)) {
    return Response.json(
      { ok: false, error: "This order can't be resent. Contact support with your reference if you need help." },
      { status: 409 },
    );
  }

  const result = await resendNumberCode(order);
  if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: result.status });

  return Response.json({ ok: true, resent: true });
}
