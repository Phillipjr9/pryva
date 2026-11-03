import { authorizeAdminApi } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { securityViolations } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { SECURITY_VIOLATION_TYPES } from "@/lib/security-violation-types";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/security/metrics
 * Returns security metrics and recent violations for admin dashboard
 */
export async function GET(request: NextRequest) {
  try {
    const access = await authorizeAdminApi(request);
    if (access.response) return access.response;

    // Get total violations count
    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(securityViolations);
    const totalViolations = Number(totalResult[0]?.count || 0);

    // One number per type the writer can store, walked from its list rather than
    // typed out again here. One query per type, not a `groupBy`: the in-memory
    // preview database has no `groupBy`, and this route has to answer there too.
    const byType: Record<string, number> = {};
    for (const spec of SECURITY_VIOLATION_TYPES) {
      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(securityViolations)
        .where(eq(securityViolations.type, spec.type));
      byType[spec.type] = Number(result[0]?.count || 0);
    }

    // Get recent violations (last 50)
    const recentViolations = await db
      .select()
      .from(securityViolations)
      .orderBy(desc(securityViolations.createdAt))
      .limit(50);

    return NextResponse.json({
      metrics: {
        totalViolations,
        byType,
      },
      violations: recentViolations.map((v) => ({
        id: v.id,
        userId: v.userId,
        userEmail: v.userEmail,
        type: v.type,
        details: v.details,
        timestamp: v.createdAt,
        ip: v.ip,
        url: v.url,
      })),
    });
  } catch (error) {
    console.error("Failed to fetch security metrics:", error);
    return NextResponse.json(
      { error: "Failed to fetch security metrics" },
      { status: 500 }
    );
  }
}
