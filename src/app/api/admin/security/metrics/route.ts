import { authorizeAdminApi } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { securityViolations } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";

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

    // Get violations by type
    const devToolsResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(securityViolations)
      .where(eq(securityViolations.type, "devtools"));
    const devToolsDetections = Number(devToolsResult[0]?.count || 0);

    const debuggerResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(securityViolations)
      .where(eq(securityViolations.type, "debugger"));
    const debuggerDetections = Number(debuggerResult[0]?.count || 0);

    const injectionResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(securityViolations)
      .where(eq(securityViolations.type, "injection"));
    const injectionAttempts = Number(injectionResult[0]?.count || 0);

    const scrapingResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(securityViolations)
      .where(eq(securityViolations.type, "scraping"));
    const scrapingAttempts = Number(scrapingResult[0]?.count || 0);

    const iframeResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(securityViolations)
      .where(eq(securityViolations.type, "iframe"));
    const iframeDetections = Number(iframeResult[0]?.count || 0);

    // Get recent violations (last 50)
    const recentViolations = await db
      .select()
      .from(securityViolations)
      .orderBy(desc(securityViolations.createdAt))
      .limit(50);

    return NextResponse.json({
      metrics: {
        totalViolations,
        devToolsDetections,
        debuggerDetections,
        injectionAttempts,
        scrapingAttempts,
        iframeDetections,
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
