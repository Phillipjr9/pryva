import { NextRequest, NextResponse } from "next/server";

import { authorizeAdminApi } from "@/lib/admin-auth";
import { recordAdminAction } from "@/lib/admin-audit";
import { listFraudEvents, markFraudEventReviewed } from "@/lib/fraud";
import { logger } from "@/lib/logger";
import { isSameOriginMutation } from "@/lib/net";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET /api/admin/security/fraud
 *
 * The fraud queue: what looked wrong, newest first, with the reasons in words.
 * Read-only — these rows are advisory, and nothing here moves money.
 */
export async function GET(request: NextRequest) {
  const access = await authorizeAdminApi(request);
  if (access.response) return access.response;

  try {
    const openOnly = request.nextUrl.searchParams.get("open") === "1";
    const events = await listFraudEvents({ openOnly, limit: 100 });
    return NextResponse.json(
      { ok: true, events, open: events.filter((event) => event.reviewedAt === null).length },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logger.error("Failed to read the fraud queue", { error });
    return NextResponse.json({ error: "Failed to read the fraud queue" }, { status: 500 });
  }
}

/**
 * POST /api/admin/security/fraud — { id }
 *
 * Marks one event reviewed. Deliberately the only write: an operator decides what
 * a signal means, and the queue is emptied by judgement rather than by a rule.
 */
export async function POST(request: NextRequest) {
  const access = await authorizeAdminApi(request);
  if (access.response) return access.response;
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const id = body && typeof body === "object" && !Array.isArray(body) ? (body as { id?: unknown }).id : null;
  if (typeof id !== "string" || !UUID.test(id)) {
    return NextResponse.json({ error: "A valid event id is required" }, { status: 400 });
  }

  const reviewed = await markFraudEventReviewed(id.toLowerCase(), access.user.id);
  if (!reviewed) return NextResponse.json({ error: "That event is already reviewed." }, { status: 409 });

  await recordAdminAction({
    actor: access.user,
    action: "fraud.review",
    targetType: "fraud_event",
    targetId: id.toLowerCase(),
    summary: "Fraud signal marked reviewed",
  });

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
