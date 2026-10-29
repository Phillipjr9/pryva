import { authorizeAdminApi } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contactMessages } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { isMessageStatus } from "@/lib/support-messages";
import { isSameOriginMutation } from "@/lib/net";

export const dynamic = "force-dynamic";

// GET /api/admin/messages - List all contact messages
export async function GET(request: NextRequest) {
  try {
    const access = await authorizeAdminApi(request);
    if (access.response) return access.response;

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
  // These are the most privileged mutations in the app: they move real money out
  // and edit accounts. Cookie-based admin sessions make them a CSRF target, so
  // the origin is checked before authorization -- failing fast also avoids
  // telling an unauthenticated cross-origin caller anything about the account.
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  try {
    const access = await authorizeAdminApi(request);
    if (access.response) return access.response;

    if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 2_048);
    } catch (error) {
      return NextResponse.json({ error: "Invalid request body" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    const { messageId, status } = body as { messageId?: unknown; status?: unknown };

    if (typeof messageId !== "string" || !/^[a-z0-9-]{1,64}$/i.test(messageId) || typeof status !== "string") {
      return NextResponse.json({ error: "Message ID and status are required" }, { status: 400 });
    }

    if (!isMessageStatus(status)) {
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
