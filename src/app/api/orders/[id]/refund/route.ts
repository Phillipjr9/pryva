import { and, eq } from "drizzle-orm";
import { db, hasDatabase } from "@/db";
import { orders } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { cancelUpstream } from "@/lib/fulfillment";
import { creditWallet } from "@/lib/wallet";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ ok: false, error: "Please sign in first." }, { status: 401 });
  }
  if (!hasDatabase) {
    return Response.json(
      { ok: false, error: "Order actions are unavailable in this read-only demo preview." },
      { status: 503 },
    );
  }

  const { id } = await params;

  try {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.userId, user.id)))
      .limit(1);

    if (!order) {
      return Response.json({ ok: false, error: "We couldn't find that order." }, { status: 404 });
    }
    if (order.status !== "active") {
      return Response.json(
        { ok: false, error: "This order is already complete or refunded." },
        { status: 409 },
      );
    }

    // 1. Cancel upstream (Fleexa refunds their wallet automatically).
    //    If the upstream call fails we still refund the Pryva wallet — the
    //    support team reconciles upstream afterwards.
    try {
      await cancelUpstream({
        provider: order.provider,
        providerRequestId: order.providerRequestId,
        service: order.service,
      });
    } catch (upstreamError) {
      console.error("Upstream cancel failed for", order.reference, upstreamError);
    }

    const [updated] = await db
      .update(orders)
      .set({ status: "refunded", refundedAt: new Date() })
      .where(and(eq(orders.id, id), eq(orders.status, "active")))
      .returning({ id: orders.id });

    if (!updated) {
      return Response.json({ ok: false, error: "This order can no longer be refunded." }, { status: 409 });
    }

    const balance = await creditWallet({
      userId: user.id,
      amount: order.amount,
      type: "refund",
      description: `Auto-refund · ${order.productName}`,
      orderId: order.id,
    });

    return Response.json({ ok: true, balance, providerCancelled: order.provider === "fleexa" });
  } catch {
    return Response.json(
      { ok: false, error: "The refund didn't go through. Please contact support." },
      { status: 500 },
    );
  }
}
