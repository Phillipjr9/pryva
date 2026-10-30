import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth";
import { InboxError, pollInbox } from "@/lib/disposable-inbox";
import { logger } from "@/lib/logger";
import { isSameOriginMutation } from "@/lib/net";
import { inboxPollRateLimiter } from "@/lib/rate-limit";
import { readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/inbox/poll — read what has arrived in one of this customer's inboxes.
 *
 * Polled rather than pushed, because the supplier offers no webhook for inbound
 * mail. That makes the rate limit load-bearing in a way it usually is not: the
 * supplier's request budget is shared across every customer at once, so one
 * browser tab refreshing on an interval could exhaust it and turn other
 * customers' purchases into failures. The ceiling is per account, not global.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });

    const limit = await inboxPollRateLimiter(`inbox-poll:${user.id}`);
    if (limit.unavailable) return NextResponse.json({ error: "Temporarily unavailable." }, { status: 503 });
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Checking too often. Wait a moment and try again." },
        { status: 429, headers: { "retry-after": "10" } },
      );
    }

    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 1_024);
    } catch (error) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
      );
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { inboxId } = body as { inboxId?: unknown };
    if (typeof inboxId !== "string" || !UUID.test(inboxId)) {
      return NextResponse.json({ error: "A valid inbox id is required" }, { status: 400 });
    }

    const result = await pollInbox(user.id, inboxId);
    return NextResponse.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof InboxError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    logger.error("Inbox poll failed", { reason: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Could not read that inbox." }, { status: 502 });
  }
}
