import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { db } from "@/db";
import { contactMessages } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// GET /api/admin/messages - List all contact messages
export async function GET(request: NextRequest) {
    const admin = await requireAdminApi();
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  try {
    const { searchParams } = request.nextUrl;
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50")));
    const offset = (page - 1) * limit;
    const status = searchParams.get("status");

    let query = db.select().from(contactMessages).orderBy(desc(contactMessages.createdAt));

    if (status) {
      query = query.where(eq(contactMessages.status, status)) as typeof query;
    }

    const messages = await query.limit(limit).offset(offset);

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(contactMessages);

    const total = Number(countResult[0]?.count || 0);

    return NextResponse.json({
      ok: true,
      messages: messages.map((m) => ({
        id: m.id,
        userId: m.userId,
        name: m.name,
        email: m.email,
        topic: m.topic,
        message: m.message,
        status: m.status,
        createdAt: m.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error("Failed to fetch admin messages", { error });
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}

// PATCH /api/admin/messages - Update message status
export async function PATCH(request: NextRequest) {
    const admin = await requireAdminApi();
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  try {
    const body = await request.json();
    const { messageId, status } = body;

    if (!messageId || !status) {
      return NextResponse.json({ error: "Message ID and status are required" }, { status: 400 });
    }

    if (!["open", "in_progress", "resolved", "closed"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    await db
      .update(contactMessages)
      .set({ status })
      .where(eq(contactMessages.id, messageId));

    logger.info("Message status updated", { messageId, status });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Failed to update message status", { error });
    return NextResponse.json({ error: "Failed to update message" }, { status: 500 });
  }
}
