import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// POST /api/notifications/mark-read - Mark notifications as read
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { notificationIds, markAll = false } = body;

    if (markAll) {
      // Mark all user notifications as read
      await db
        .update(notifications)
        .set({ read: 1 })
        .where(eq(notifications.userId, user.id));

      logger.info("All notifications marked as read", { userId: user.id });

      return NextResponse.json({ ok: true, message: "All notifications marked as read" });
    }

    if (!notificationIds || !Array.isArray(notificationIds) || notificationIds.length === 0) {
      return NextResponse.json({ error: "Notification IDs required" }, { status: 400 });
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
