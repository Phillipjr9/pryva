import { NextRequest, NextResponse } from "next/server";
import { count, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { accountDeletions, users } from "@/db/schema";
import { diagnosticsAuthorized } from "@/lib/diagnostics-auth";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { logger } from "@/lib/logger";
import { RETENTION_YEARS, countDueForPurge, purgeEnabled, retentionCutoff } from "@/lib/retention";

export const dynamic = "force-dynamic";

/**
 * GET /api/diagnostics/retention
 * Authorization: Bearer <DIAGNOSTICS_SECRET>  (CRON_SECRET also accepted)
 *
 * "How much closed-account data are we still holding, and when does it start going?"
 *
 * Read-only by construction: this endpoint cannot purge anything, whatever it is
 * asked. The sweep lives in the nightly job and only runs when
 * `RETENTION_PURGE_ENABLED=true`, because deleting financial records is not
 * something to trigger from a URL.
 *
 * The horizon is deliberately not customer-facing — the owner's decision is that
 * customers are told the record is kept "as long as the law and disputes require".
 * That makes this an operator surface behind a bearer token, and the reason the
 * number lives in a server-only module (`src/lib/retention.ts`).
 */
export async function GET(request: NextRequest) {
  if (!diagnosticsAuthorized(request)) {
    logger.warn("Unauthorized retention diagnostics attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isPreviewDatabase()) {
    return NextResponse.json(
      { checkedAt: new Date().toISOString(), verdict: "preview", explanation: "No persistent database on this deployment." },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const [closed] = await db.select({ total: count() }).from(users).where(isNotNull(users.deletedAt));
    const [receipts] = await db.select({ total: count() }).from(accountDeletions);
    const due = await countDueForPurge();
    const armed = purgeEnabled();

    return NextResponse.json(
      {
        checkedAt: new Date().toISOString(),
        verdict: due > 0 ? (armed ? "purging" : "armed_off_with_due") : "current",
        explanation: due > 0
          ? armed
            ? `${due} closed account(s) are past the horizon; the nightly job removes up to 25 per run.`
            : `${due} closed account(s) are past the horizon and the sweep is disarmed. Set RETENTION_PURGE_ENABLED=true to remove them.`
          : "No closed account has reached the retention horizon.",
        retentionYears: RETENTION_YEARS,
        cutoff: retentionCutoff().toISOString(),
        armed,
        closedAccounts: Number(closed?.total ?? 0),
        dueForPurge: due,
        closures: Number(receipts?.total ?? 0),
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logger.error("Retention diagnostics failed", { error });
    return NextResponse.json(
      { checkedAt: new Date().toISOString(), verdict: "unreachable", explanation: "The database could not be read." },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}
