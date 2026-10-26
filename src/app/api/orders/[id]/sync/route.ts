import { and, desc, eq } from "drizzle-orm";
import { db, hasDatabase } from "@/db";
import { orders, walletTransactions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  checkFleexaEmail,
  checkFleexaSms,
  getFleexaRentalSms,
  FleexaError,
} from "@/lib/fleexa";

export const dynamic = "force-dynamic";

/**
 * Polls Fleexa for the latest code on an order, updates the local record,
 * and returns the newest state. Safe to call repeatedly (every 8–20s from
 * the client).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!hasDatabase) {
    return Response.json({ ok: false, error: "Order sync is unavailable in this read-only demo preview." }, { status: 503 });
  }

  const { id } = await params;

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, id), eq(orders.userId, user.id)))
    .limit(1);

  if (!order) return Response.json({ ok: false, error: "Order not found" }, { status: 404 });
  if (order.provider !== "fleexa" || !order.providerRequestId) {
    return Response.json({ ok: true, otpCode: order.otpCode, status: order.status, synced: false });
  }
  if (order.status !== "active") {
    return Response.json({ ok: true, otpCode: order.otpCode, status: order.status, synced: true });
  }

  try {
    let code: string | null = null;
    let upstreamStatus = "pending";
    let lastMessage: string | null = null;

    if (order.service === "email-otp") {
      const result = await checkFleexaEmail(order.providerRequestId);
      code = result.code;
      lastMessage = result.messages[0]?.body ?? null;
      upstreamStatus = code ? "delivered" : "pending";
    } else if (order.duration.startsWith("Rent")) {
      const result = await getFleexaRentalSms(order.providerRequestId);
      const latest = result.messages[0];
      code = latest?.code ?? null;
      lastMessage = latest?.body ?? null;
      upstreamStatus = code ? "delivered" : "pending";
    } else {
      const result = await checkFleexaSms(order.providerRequestId);
      code = result.code;
      lastMessage = result.message;
      upstreamStatus = result.status;
    }

    const updates: Partial<typeof orders.$inferSelect> = {};
    if (code && code !== order.otpCode) updates.otpCode = code;
    if (upstreamStatus === "delivered" || code) updates.status = "delivered";
    if ((upstreamStatus === "cancelled" || upstreamStatus === "expired") && order.expiresAt && order.expiresAt < new Date()) {
      updates.status = "expired";
    }

    if (Object.keys(updates).length > 0) {
      await db.update(orders).set(updates).where(eq(orders.id, order.id));
    }

    return Response.json({
      ok: true,
      otpCode: updates.otpCode ?? order.otpCode,
      status: updates.status ?? order.status,
      lastMessage,
      synced: true,
    });
  } catch (error) {
    if (error instanceof FleexaError && error.status === 404) {
      return Response.json({ ok: true, otpCode: order.otpCode, status: order.status, synced: false });
    }
    return Response.json({ ok: false, error: "Couldn't sync just now — try again." }, { status: 502 });
  }
}

/* Latest wallet activity for the order panel — useful on refund. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!hasDatabase) {
    return Response.json({ ok: false, error: "Order actions are unavailable in this read-only demo preview." }, { status: 503 });
  }

  const [tx] = await db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.id))
    .orderBy(desc(walletTransactions.createdAt))
    .limit(1);

  return Response.json({ ok: true, balance: tx?.balanceAfter ?? user.walletBalance });
}
