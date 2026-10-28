import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requireAuthApi } from "@/lib/auth";
import { clientIp } from "@/lib/auth-rate-limit";
import { securityReportRateLimiter } from "@/lib/rate-limit";
import { isSameOriginMutation, publicOrigin } from "@/lib/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { db } from "@/db";
import { securityViolations } from "@/db/schema";

export const dynamic = "force-dynamic";

const knownReports: Record<string, string> = {
  "DevTools detected": "devtools",
  "Debugger attached": "debugger",
  "Code injection detected": "injection",
  "Running in iframe": "iframe",
  "Modified environment detected": "modified_environment",
};

/** Client reports are untrusted telemetry, not proof of an attack. */
export async function POST(request: NextRequest) {
  const user = await requireAuthApi();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });

  const limit = await securityReportRateLimiter(`security-report:${user.id}`);
  if (limit.unavailable) return NextResponse.json({ error: "Reporting is temporarily unavailable" }, { status: 503 });
  if (!limit.allowed) return NextResponse.json({ error: "Too many reports" }, { status: 429 });

  let body: unknown;
  try {
    body = await readJsonWithLimit(request, 8_192);
  } catch (error) {
    return NextResponse.json({ error: "Invalid report" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid report" }, { status: 400 });
  }
  const fields = body as { violations?: unknown; url?: unknown };
  if (!Array.isArray(fields.violations) || fields.violations.length < 1 || fields.violations.length > 10) {
    return NextResponse.json({ error: "Invalid report" }, { status: 400 });
  }
  const reports: { type: string; details: string }[] = [];
  for (const value of fields.violations) {
    if (typeof value !== "string" || value.length > 240 || /[\x00-\x1f\x7f]/.test(value)) {
      return NextResponse.json({ error: "Invalid report" }, { status: 400 });
    }
    const type = knownReports[value] ?? (value.startsWith("Scraping detected: ") ? "scraping" : null);
    if (!type) return NextResponse.json({ error: "Invalid report" }, { status: 400 });
    reports.push({ type, details: value });
  }

  // Keep only a same-origin path; query strings and fragments can contain secrets.
  let path: string | null = null;
  if (fields.url != null) {
    if (typeof fields.url !== "string" || fields.url.length > 2_048) return NextResponse.json({ error: "Invalid report" }, { status: 400 });
    try {
      const base = new URL(publicOrigin(request));
      const reported = new URL(fields.url, base);
      if (reported.origin !== base.origin || reported.pathname.length > 500) throw new Error("Invalid URL");
      path = reported.pathname;
    } catch {
      return NextResponse.json({ error: "Invalid report" }, { status: 400 });
    }
  }
  const ip = clientIp(request);
  const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null;
  try {
    await db.transaction(async (tx) => {
      for (const report of reports) {
        await tx.insert(securityViolations).values({
          userId: user.id, userEmail: user.email, ...report,
          ip: ip === "unknown" ? null : ip, url: path, userAgent,
        });
      }
    });
    logger.warn("Client security telemetry received", { userId: user.id, count: reports.length });
    return NextResponse.json({ ok: true, message: "Report received", violationsCount: reports.length });
  } catch {
    logger.error("Failed to store client security telemetry");
    return NextResponse.json({ error: "Failed to process report" }, { status: 500 });
  }
}
