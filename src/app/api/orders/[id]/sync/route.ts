import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { orders, walletTransactions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { createRateLimiter } from "@/lib/rate-limit";
import { isPreviewDatabase } from "@/lib/demo-policy";
import {
  checkFleexaEmail,
  checkFleexaSms,
  getFleexaRentalSms,
  FleexaError,
} from "@/lib/fleexa";
import { readNumberCode } from "@/lib/number-code-sync";

export const dynamic = "force-dynamic";
const orderSyncLimiter = createRateLimiter({ windowMs: 20_000, maxRequests: 1 });

/** Polls an existing provider order at the documented 20–30 second cadence. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || (isPreviewDatabase() && /^[a-z0-9-]{1,64}$/i.test(id)))) {
    return Response.json({ ok: false, error: "Order not found" }, { status: 404 });
  }

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, id), eq(orders.userId, user.id)))
    .limit(1);

  if (!order) return Response.json({ ok: false, error: "Order not found" }, { status: 404 });
  // Only the products whose provider returns something on demand are syncable.
  // An eSIM is bought through the same gateway as numbers, so the service is
  // checked too: without it, an eSIM order would be sent to the number endpoint.
  const syncable =
    (order.service === "numbers" && (order.provider === "fleexa" || order.provider === "bitcall")) ||
    (order.service === "email-otp" && order.provider === "fleexa");
  if (!order.providerRequestId || !syncable) {
    return Response.json({ ok: true, otpCode: order.otpCode, status: order.status, synced: false });
  }
  if (order.status !== "active") {
    return Response.json({ ok: true, otpCode: order.otpCode, status: order.status, synced: true });
  }
  const limit = await orderSyncLimiter(`order-sync:${user.id}:${order.id}`);
  if (limit.unavailable) return Response.json({ ok: false, error: "Sync is temporarily unavailable." }, { status: 503 });
  if (!limit.allowed) return Response.json({ ok: false, error: "Too many sync requests. Try again shortly." }, { status: 429 });

  try {
    let code: string | null = null;
    let upstreamStatus = "pending";
    let lastMessage: string | null = null;

    if (order.service === "numbers" && !order.duration.startsWith("Rent")) {
      // One read per supplier, shared with the nightly sweep, so the page and the
      // sweep can never disagree about whether a code arrived.
      const read = await readNumberCode(order);
      code = read.code;
      lastMessage = read.message;
      upstreamStatus = read.status;
    } else if (order.service === "email-otp") {
      const result = await checkFleexaEmail(order.providerRequestId);
      code = result.code;
      lastMessage = result.messages[0]?.body ?? null;
      upstreamStatus = code ? "delivered" : "pending";
    } else {
      const result = await getFleexaRentalSms(order.providerRequestId);
      const dated = result.messages
        .map((message) => ({ message, time: message.at ? Date.parse(message.at) : NaN }))
        .filter((entry) => Number.isFinite(entry.time))
        .sort((a, b) => b.time - a.time);
      const latest = dated[0]?.message ?? (result.messages.length === 1 ? result.messages[0] : null);
      code = latest?.code ?? null;
      lastMessage = latest?.body ?? null;
      upstreamStatus = code ? "delivered" : "pending";
    }

    const updates: Partial<typeof orders.$inferSelect> = {};
    if (code && code !== order.otpCode) updates.otpCode = code;
    // A rental can receive more than one message; one code must not end it.
    if (!order.duration.startsWith("Rent") && (upstreamStatus === "delivered" || code)) updates.status = "delivered";
    if ((upstreamStatus === "cancelled" || upstreamStatus === "expired") && order.expiresAt && order.expiresAt < new Date()) {
      updates.status = "expired";
    }

    if (Object.keys(updates).length > 0) {
      // A refund or another sync may have completed while the provider call was
      // in flight. Never overwrite the newer status with this stale response.
      const [saved] = await db.update(orders).set(updates)
        .where(and(eq(orders.id, order.id), eq(orders.status, "active"), isNull(orders.refundedAt),
          order.otpCode === null ? isNull(orders.otpCode) : eq(orders.otpCode, order.otpCode)))
        .returning();
      if (!saved) {
        const [current] = await db.select().from(orders)
          .where(and(eq(orders.id, order.id), eq(orders.userId, user.id))).limit(1);
        if (!current) return Response.json({ ok: false, error: "Order not found" }, { status: 404 });
        return Response.json({ ok: true, otpCode: current.otpCode, status: current.status, synced: false });
      }
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

  const [tx] = await db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.id))
    .orderBy(desc(walletTransactions.createdAt))
    .limit(1);

  return Response.json({ ok: true, balance: tx?.balanceAfter ?? user.walletBalance });
}
