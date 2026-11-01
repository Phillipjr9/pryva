import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { orders } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { completeEsimOrder } from "@/lib/esim-fulfilment";
import { isSameOriginMutation } from "@/lib/net";
import { purchaseRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Try to finish an eSIM order that was still provisioning at checkout.
 *
 * Owner-scoped, idempotent and free to call: it reads the supplier back and only
 * then records and charges, so a customer refreshing this page can never be
 * charged twice for the same profile.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Please sign in." }, { status: 401 });
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, error: "Cross-origin request denied." }, { status: 403 });

  const limit = await purchaseRateLimiter(`esim-complete:${user.id}`);
  if (!limit.unavailable && !limit.allowed) {
    return Response.json({ ok: false, error: "Too many attempts. Try again shortly." }, { status: 429 });
  }

  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ ok: false, error: "Order not found." }, { status: 404 });

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, id), eq(orders.userId, user.id)))
    .limit(1);
  if (!order || order.service !== "esim") {
    return Response.json({ ok: false, error: "Order not found." }, { status: 404 });
  }

  if (order.esimActivationCode) {
    return Response.json({ ok: true, delivered: true }, { headers: { "Cache-Control": "no-store" } });
  }
  if (order.status !== "processing") {
    return Response.json(
      { ok: false, delivered: false, message: "This order cannot be completed here. Contact support with the reference." },
      { status: 409 },
    );
  }

  const result = await completeEsimOrder(order);
  if (result.kind === "delivered") {
    return Response.json({ ok: true, delivered: true }, { headers: { "Cache-Control": "no-store" } });
  }
  if (result.kind === "pending") {
    return Response.json({
      ok: true,
      delivered: false,
      message: "Still provisioning. It appears here as soon as the supplier issues the profile.",
    });
  }
  return Response.json(
    {
      ok: false,
      delivered: false,
      message:
        result.kind === "unpaid"
          ? "The profile is ready, but your wallet balance no longer covers it. Top up and check again — nothing was charged."
          : "This profile could not be delivered. Nothing was charged; support has been given the record.",
    },
    { status: 409 },
  );
}
