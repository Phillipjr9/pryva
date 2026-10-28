import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuthApi } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/net";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// POST /api/notifications/mark-read - Mark notifications as read
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 16_384);
    } catch (error) {
      return NextResponse.json({ error: "Invalid request" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    const { notificationIds, markAll } = body as { notificationIds?: unknown; markAll?: unknown };

    if (markAll === true) {
      // Mark all user notifications as read
      await db
        .update(notifications)
        .set({ read: 1 })
        .where(eq(notifications.userId, user.id));

      logger.info("All notifications marked as read", { userId: user.id });

      return NextResponse.json({ ok: true, message: "All notifications marked as read" });
    }

    if (!Array.isArray(notificationIds) || notificationIds.length === 0 || notificationIds.length > 100 || notificationIds.some((id) =>
      typeof id !== "string" || !(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || (isPreviewDatabase() && /^[a-z0-9-]{1,64}$/i.test(id)))
    )) {
      return NextResponse.json({ error: "Provide up to 100 valid notification IDs" }, { status: 400 });
    }

    // Mark specific notifications as read
    for (const id of notificationIds) {
      await db
        .update(notifications)
        .set({ read: 1 })
        .where(and(eq(notifications.id, id), eq(notifications.userId, user.id)));
    }

    logger.info("Notifications marked as read", { userId: user.id, count: notificationIds.length });

    return NextResponse.json({ ok: true, message: "Notifications marked as read" });
  } catch (error) {
    logger.error("Failed to mark notifications as read", { error });
    return NextResponse.json({ error: "Failed to update notifications" }, { status: 500 });
  }
}
