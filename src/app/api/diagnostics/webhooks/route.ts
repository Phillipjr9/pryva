import { NextRequest, NextResponse } from "next/server";

import { diagnosticsAuthorized } from "@/lib/diagnostics-auth";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { logger } from "@/lib/logger";
import { recentWebhookActivity } from "@/lib/webhook-events";

export const dynamic = "force-dynamic";

/**
 * GET /api/diagnostics/webhooks
 * Authorization: Bearer <DIAGNOSTICS_SECRET>  (CRON_SECRET also accepted)
 *
 * "Is the payment webhook actually arriving, and is it doing anything?"
 *
 * The question used to be unanswerable except by inference: a payout that stayed at
 * "Sent to bank" could be a missing delivery, a filtered event type, a rotated key
 * or an endpoint that was never saved. Each of those has a different fix, and
 * guessing between them costs a customer a day of their money.
 *
 * Read-only. It never re-sends, retries or applies anything.
 *
 * The verdicts, and what each one means for the operator:
 *
 *   receiving    — payout events are arriving; nothing to do
 *   only_topups  — the endpoint works but transfer events are not reaching it, so
 *                  payouts wait for the nightly sweep
 *   silent       — nothing at all; the URL, the deployment or the key is wrong
 */
export async function GET(request: NextRequest) {
  if (!diagnosticsAuthorized(request)) {
    logger.warn("Unauthorized webhook diagnostics attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isPreviewDatabase()) {
    return NextResponse.json(
      { checkedAt: new Date().toISOString(), verdict: "preview", explanation: "No persistent database on this deployment." },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const activity = await recentWebhookActivity();
    return NextResponse.json(
      { checkedAt: new Date().toISOString(), ...activity },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logger.error("Webhook diagnostics failed", { error });
    return NextResponse.json(
      { checkedAt: new Date().toISOString(), verdict: "unreachable", explanation: "The delivery log could not be read." },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
