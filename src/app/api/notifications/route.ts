import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { and, eq, desc, count } from "drizzle-orm";
import { requireAuthApi } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/net";
import { notificationRateLimiter } from "@/lib/rate-limit";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limitText = request.nextUrl.searchParams.get("limit") ?? "50";
    const offsetText = request.nextUrl.searchParams.get("offset") ?? "0";
    if (!/^\d{1,5}$/.test(limitText) || !/^\d{1,5}$/.test(offsetText)) return NextResponse.json({ error: "Invalid pagination" }, { status: 400 });
    const limit = Number(limitText);
    const offset = Number(offsetText);
    if (limit < 1 || limit > 100 || offset > 10_000) return NextResponse.json({ error: "Invalid pagination" }, { status: 400 });

    const userNotifications = await db.query.notifications.findMany({
      where: eq(notifications.userId, user.id),
      orderBy: [desc(notifications.createdAt)],
      limit,
      offset,
    });

    const [total] = await db.select({ value: count() }).from(notifications).where(eq(notifications.userId, user.id));
    const [unread] = await db.select({ value: count() }).from(notifications).where(and(eq(notifications.userId, user.id), eq(notifications.read, 0)));

    return NextResponse.json({
      ok: true,
      notifications: userNotifications.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        read: Boolean(n.read),
        createdAt: n.createdAt.toISOString(),
      })),
      unreadCount: Number(unread?.value ?? 0),
      total: Number(total?.value ?? 0),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to fetch notifications:", error);
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });

    // Throttled per account: an authenticated route has a better identity than an
    // IP, and a shared NAT would let one user's traffic exhaust another's allowance.
    const throttle = await notificationRateLimiter(`notifications:${user.id}`);
    if (throttle.unavailable) {
      return NextResponse.json({ error: "Temporarily unavailable. Try again shortly." }, { status: 503 });
    }
    if (!throttle.allowed) {
      return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
    }
    if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 2_048);
    } catch (error) {
      return NextResponse.json({ error: "Invalid request" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    const { notificationId, markAllRead } = body as { notificationId?: unknown; markAllRead?: unknown };

    if (markAllRead === true) {
      await db
        .update(notifications)
        .set({ read: 1 })
        .where(eq(notifications.userId, user.id));
    } else if (typeof notificationId === "string" && (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(notificationId) || (isPreviewDatabase() && /^[a-z0-9-]{1,64}$/i.test(notificationId)))) {
      await db
        .update(notifications)
        .set({ read: 1 })
        .where(and(eq(notifications.id, notificationId), eq(notifications.userId, user.id)));
    } else {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to update notifications:", error);
    return NextResponse.json({ error: "Failed to update notifications" }, { status: 500 });
  }
}
