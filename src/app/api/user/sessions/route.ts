import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { cookies } from "next/headers";
import { SESSION_COOKIE, requireAuth } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// GET /api/user/sessions - List user's active sessions
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userSessions = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user.id))
      .orderBy(desc(sessions.createdAt));

    // The app authenticates with an httpOnly cookie, not a bearer token.
    const currentToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
    const now = new Date();
    const activeSessions = userSessions.filter((s) => s.expiresAt > now);

    return NextResponse.json({
      ok: true,
      sessions: activeSessions.map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        isCurrent: Boolean(currentToken) && s.token === currentToken,
      })),
      count: activeSessions.length,
    });
  } catch (error) {
    logger.error("Failed to fetch user sessions", { error });
    return NextResponse.json({ error: "Failed to fetch sessions" }, { status: 500 });
  }
}

// DELETE /api/user/sessions - Revoke a session
export async function DELETE(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { sessionId, revokeAll = false } = body;

    if (revokeAll) {
      // Revoke all sessions except current
      const currentToken = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
      const userSessions = await db
        .select()
        .from(sessions)
        .where(eq(sessions.userId, user.id));

      for (const session of userSessions) {
        if (session.token !== currentToken) {
          await db.delete(sessions).where(eq(sessions.id, session.id));
        }
      }

      logger.info("All sessions revoked except current", { userId: user.id });

      return NextResponse.json({ ok: true, message: "All other sessions revoked" });
    }

    if (!sessionId) {
      return NextResponse.json({ error: "Session ID required" }, { status: 400 });
    }

    // Verify session belongs to user
    const session = await db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!session || session.userId !== user.id) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    await db.delete(sessions).where(eq(sessions.id, sessionId));

    logger.info("Session revoked", { userId: user.id, sessionId });

    return NextResponse.json({ ok: true, message: "Session revoked" });
  } catch (error) {
    logger.error("Failed to revoke session", { error });
    return NextResponse.json({ error: "Failed to revoke session" }, { status: 500 });
  }
}
