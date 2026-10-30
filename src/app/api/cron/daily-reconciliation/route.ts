import { NextRequest, NextResponse } from "next/server";
import { lagosDay, runDailyReconciliation } from "@/lib/daily-reconciliation";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/cron/daily-reconciliation
 *
 * Closes yesterday's books: the day's totals per money source, plus a check that
 * every account's wallet ledger still adds up. Read-only against money tables —
 * the run writes nothing except its own row in `reconciliation_runs`.
 *
 * `?day=YYYY-MM-DD` backfills a specific Lagos business day. Re-running a day is
 * safe: it corrects that day's row instead of creating a second one.
 */
async function handler(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    logger.warn("Unauthorized daily reconciliation attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requested = request.nextUrl.searchParams.get("day");
  const day = requested ?? previousLagosDay();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json({ error: "day must be YYYY-MM-DD" }, { status: 400 });
  }

  try {
    const result = await runDailyReconciliation(day);
    logger.info("Daily reconciliation completed", {
      day: result.day,
      status: result.status,
      discrepancies: result.discrepancies,
    });
    return NextResponse.json({
      ok: result.status === "clean",
      day: result.day,
      status: result.status,
      totals: result.totals,
      accountsChecked: result.accountsChecked,
      discrepancies: result.discrepancies,
      // The breaks themselves are on /admin/reconciliation, not in a cron
      // response: an account id in a log line is data leaking into a place
      // nobody audits.
      note: result.externalNote,
    });
  } catch (error) {
    logger.error("Daily reconciliation failed", {
      day,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Reconciliation failed" }, { status: 500 });
  }
}

/** Yesterday in Lagos, which is what the 02:20 local cron is closing. */
function previousLagosDay(): string {
  return lagosDay(new Date(Date.now() - 24 * 60 * 60 * 1000));
}

export const POST = handler;
/** Vercel Cron issues GET requests; treat it identically. */
export const GET = handler;
