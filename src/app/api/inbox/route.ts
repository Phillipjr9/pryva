import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth";
import { clientIp } from "@/lib/auth-rate-limit";
import { isPreviewDatabase } from "@/lib/demo-policy";
import {
  createFreeInbox,
  InboxError,
  isInboxConfigured,
  listInboxes,
  mayHaveSpentMoney,
} from "@/lib/disposable-inbox";
import { logger } from "@/lib/logger";
import { isSameOriginMutation } from "@/lib/net";
import { apiRateLimiter, inboxCreateIpRateLimiter, releaseRateLimit } from "@/lib/rate-limit";
import { readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const dynamic = "force-dynamic";

/**
 * GET  /api/inbox — this customer's inboxes.
 * POST /api/inbox — buy a free one.
 *
 * Creating an inbox spends money with the supplier the moment it is accepted, so
 * the request is authenticated, same-origin, rate-limited per IP and refused
 * outright in a preview environment. The per-account daily cap is not enforced
 * here: it lives in a partial unique index, because two concurrent requests would
 * both pass a count and both buy.
 */
export async function GET() {
  try {
    const user = await requireAuthApi();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const limit = await apiRateLimiter(`inbox-list:${user.id}`);
    if (limit.unavailable) return NextResponse.json({ error: "Temporarily unavailable." }, { status: 503 });
    if (!limit.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

    const inboxes = await listInboxes(user.id);
    // "Not switched on" covered two different situations and the page could not
    // tell them apart: a preview deployment with no database behind it, and a
    // deployment whose inbox feed has no credential. They need different fixes, so
    // the response names the one that applies.
    const reason = isPreviewDatabase()
      ? ("preview" as const)
      : !isInboxConfigured()
        ? ("not_configured" as const)
        : null;
    return NextResponse.json(
      { ok: true, inboxes, configured: reason === null, reason },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    logger.error("Inbox list failed", { reason: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Could not load your inboxes." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });

    // Two different refusals, because they need two different fixes: a preview
    // deployment has no database behind it, and a deployment without the inbox
    // credential has nothing to buy from. One shared message made both look like
    // "the feature is off".
    if (isPreviewDatabase()) {
      return NextResponse.json(
        { error: "Temporary inboxes are unavailable on this deployment.", code: "PREVIEW" },
        { status: 503 },
      );
    }
    if (!isInboxConfigured()) {
      return NextResponse.json(
        { error: "Temporary inboxes are not configured on this server.", code: "NOT_CONFIGURED" },
        { status: 503 },
      );
    }

    // Per-IP ceiling. Keyed by account instead when the IP cannot be determined,
    // because every unidentifiable caller would otherwise share one "unknown"
    // bucket and three of them between them would lock the feature out for
    // everyone. Degrading to the account keeps a bound in place, and the database
    // still enforces one free inbox per account per day regardless.
    const ip = clientIp(request);
    const limitKey = ip === "unknown" ? `inbox-create:account:${user.id}` : `inbox-create:ip:${ip}`;
    const limit = await inboxCreateIpRateLimiter(limitKey);
    if (limit.unavailable) return NextResponse.json({ error: "Temporarily unavailable." }, { status: 503 });
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Daily limit reached from this connection. Try again tomorrow." },
        { status: 429 },
      );
    }

    // The body is read only to reject one that is too large. Nothing in it is
    // trusted or used: which inbox you get is the supplier's decision, not a
    // parameter, so there is nothing here for a caller to influence.
    try {
      await readJsonWithLimit(request, 1_024);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return NextResponse.json({ error: "Request body too large" }, { status: 413 });
      }
      // An empty body is the normal case; a create takes no parameters.
    }

    try {
      const inbox = await createFreeInbox(user.id);
      return NextResponse.json({ ok: true, inbox }, { status: 201, headers: { "cache-control": "no-store" } });
    } catch (error) {
      // A failed attempt that cost nothing must not cost the customer tomorrow's
      // inbox. The limiter counts attempts, so pressing a broken button three
      // times used to lock that connection out for a day — turning one bug into a
      // second, longer one. Where money may already have moved, the slot stands.
      if (!mayHaveSpentMoney(error)) {
        await releaseRateLimit(limitKey);
      } else {
        logger.error("Inbox creation may have spent without recording it", {
          code: error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "unknown",
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof InboxError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    logger.error("Inbox creation failed", {
      // The provider's code, never its text: the message stays ours, and the code
      // is what tells the owner whether this is a key, a price or an outage.
      code: error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : undefined,
      reason: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Could not create an inbox." }, { status: 502 });
  }
}
