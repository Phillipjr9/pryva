import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireAuth } from "@/lib/auth";
import { db } from "@/db";
import { securityViolations } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * POST /api/security/report
 * Receives security violation reports from client-side protection
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { violations, timestamp, url, userAgent } = body;

    if (!violations || !Array.isArray(violations)) {
      return NextResponse.json({ error: "Invalid report format" }, { status: 400 });
    }

    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip");

    // Store each violation in database
    for (const violation of violations) {
      await db.insert(securityViolations).values({
        userId: user.id,
        userEmail: user.email,
        type: violation.split(":")[0].toLowerCase().replace(/\s+/g, "_"),
        details: violation,
        ip,
        url,
        userAgent,
      });
    }

    // Log the security violation
    logger.warn("Security violation reported", {
      userId: user.id,
      userEmail: user.email,
      violations,
      timestamp,
      url,
      userAgent,
      ip,
    });

    // In production, you might want to:
    // 1. Send alerts to security team
    // 2. Trigger automated responses
    // 3. Update user risk score
    // 4. Block suspicious accounts

    // For now, just acknowledge receipt
    return NextResponse.json({
      ok: true,
      message: "Report received",
      violationsCount: violations.length,
    });
  } catch (error) {
    logger.error("Failed to process security report", { error });
    return NextResponse.json({ error: "Failed to process report" }, { status: 500 });
  }
}
