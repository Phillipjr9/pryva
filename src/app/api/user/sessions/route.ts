import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sessions } from "@/db/schema";
import { and, eq, gt, ne, desc } from "drizzle-orm";
import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_COOKIE_EMBEDDED, getCurrentUser } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/net";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// GET /api/user/sessions - List user's active sessions
export async function GET(request: NextRequest) {
  try {
    // `requireAuth()` redirects (it throws NEXT_REDIRECT inside a route
    // handler and turns into a 500). API callers need a 401.
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Shared demo visitors must not inspect or revoke one another's sessions.

    const userSessions = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, user.id), gt(sessions.expiresAt, new Date())))
      .orderBy(desc(sessions.createdAt))
      .limit(200);

    // The app authenticates with an httpOnly cookie, not a bearer token.
    const jar = await cookies();
    const currentToken = jar.get(SESSION_COOKIE)?.value ?? jar.get(SESSION_COOKIE_EMBEDDED)?.value ?? null;
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
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    logger.error("Failed to fetch user sessions", { error });
    return NextResponse.json({ error: "Failed to fetch sessions" }, { status: 500 });
  }
}

// DELETE /api/user/sessions - Revoke a session
export async function DELETE(request: NextRequest) {
  try {
    // `requireAuth()` redirects (it throws NEXT_REDIRECT inside a route
    // handler and turns into a 500). API callers need a 401.
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
    if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 2_048);
    } catch (error) {
      return NextResponse.json({ error: "Invalid request" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    const { sessionId, revokeAll } = body as { sessionId?: unknown; revokeAll?: unknown };

    if (revokeAll === true) {
      // Revoke all sessions except current
      const jar = await cookies();
      const currentToken = jar.get(SESSION_COOKIE)?.value ?? jar.get(SESSION_COOKIE_EMBEDDED)?.value;
      if (!currentToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      await db.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.token, currentToken)));

      logger.info("All sessions revoked except current", { userId: user.id });

      return NextResponse.json({ ok: true, message: "All other sessions revoked" });
    }

    if (typeof sessionId !== "string" || !(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId) || (isPreviewDatabase() && /^[a-z0-9-]{1,64}$/i.test(sessionId)))) {
      return NextResponse.json({ error: "Valid session ID required" }, { status: 400 });
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
