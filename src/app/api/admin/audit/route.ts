import { NextRequest, NextResponse } from "next/server";
import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { adminAuditLog } from "@/db/schema";
import { authorizeAdminApi } from "@/lib/admin-auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 200;

/**
 * Read-only access to the admin audit trail.
 *
 * There is deliberately no POST/PATCH/DELETE: entries are written by the
 * privileged action itself, and a route that could rewrite history would defeat
 * the point. `authorizeAdminApi` enforces a verified administrator and rejects
 * cross-origin mutations; this route only reads.
 */
export async function GET(request: NextRequest) {
  try {
    const access = await authorizeAdminApi(request);
    if (access.response) return access.response;

    const params = request.nextUrl.searchParams;
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(params.get("limit") ?? "100", 10) || 100));
    const offset = Math.max(0, Number.parseInt(params.get("offset") ?? "0", 10) || 0);
    const action = (params.get("action") ?? "").trim();
    const query = (params.get("q") ?? "").trim();

    const conditions = [];
    if (action) conditions.push(eq(adminAuditLog.action, action));
    if (query) {
      conditions.push(
        or(
          ilike(adminAuditLog.actorEmail, `%${query}%`),
          ilike(adminAuditLog.targetId, `%${query}%`),
          ilike(adminAuditLog.summary, `%${query}%`),
        )!,
      );
    }
    const where = conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions);

    const entries = await db
      .select()
      .from(adminAuditLog)
      .where(where)
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db.select({ total: count() }).from(adminAuditLog).where(where);

    return NextResponse.json({ ok: true, entries, total: Number(total), limit, offset });
  } catch (error) {
    logger.error("Failed to read the admin audit log", { error });
    return NextResponse.json({ error: "Failed to read the audit log" }, { status: 500 });
  }
}
