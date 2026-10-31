import { NextRequest, NextResponse } from "next/server";

import { diagnosticsAuthorized } from "@/lib/diagnostics-auth";
import { logger } from "@/lib/logger";
import { buildStockReport } from "@/lib/stock-live";
import { laneHeadline } from "@/lib/stock-report";

export const dynamic = "force-dynamic";

/**
 * GET /api/diagnostics/stock
 * Authorization: Bearer <DIAGNOSTICS_SECRET>  (CRON_SECRET also accepted)
 * ?refresh=1 forces a fresh catalog read instead of the 30 s cache.
 *
 * Answers "what can we actually sell right now?" — per sellable plan, per account
 * listing, per boost category — from the live feeds rather than from the catalog
 * we advertise. The two used to be the same question only by assumption: numbers
 * and rentals were sold from a fixed list with no stock read at all, and a
 * connected feed with nothing on sale looked identical to a working one.
 *
 * Read-only: every call behind this is a catalog list or a balance read. Nothing
 * here can place, cancel or refund an order, which is what makes it safe to hand
 * a read-only secret to it.
 */
export async function GET(request: NextRequest) {
  if (!diagnosticsAuthorized(request)) {
    logger.warn("Unauthorized stock diagnostics attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const refresh = request.nextUrl.searchParams.get("refresh") === "1";
  const report = await buildStockReport({ refresh });

  return NextResponse.json(
    {
      ...report,
      lanes: report.lanes.map((lane) => ({ ...lane, headline: laneHeadline(lane) })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
