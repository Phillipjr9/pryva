import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth";
import { discardInbox, InboxError } from "@/lib/disposable-inbox";
import { logger } from "@/lib/logger";
import { isSameOriginMutation } from "@/lib/net";
import { purchaseRateLimiter } from "@/lib/rate-limit";
import { readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/inbox/discard — end an inbox.
 *
 * The supplier is cancelled before the row is marked discarded, and not the other
 * way round: marking first would let a failed cancellation leave the customer
 * looking at a closed inbox that is still alive and still receiving mail
 * somewhere they can no longer read. For a verification code that is the one
 * outcome worse than an error, so a discard that cannot be completed says so.
 *
 * Discarding also frees the daily slot only in the sense that it releases the
 * "one active" index. It does not refund the day: the inbox was bought, and the
 * per-day cap counts purchases, not open inboxes.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });

    const limit = await purchaseRateLimiter(`inbox-discard:${user.id}`);
    if (limit.unavailable) return NextResponse.json({ error: "Temporarily unavailable." }, { status: 503 });
    if (!limit.allowed) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });

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

    const inbox = await discardInbox(user.id, inboxId);
    return NextResponse.json({ ok: true, inbox }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof InboxError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    logger.error("Inbox discard failed", { reason: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Could not discard that inbox." }, { status: 502 });
  }
}
