import { NextRequest, NextResponse } from "next/server";
import { processAutoRefunds } from "@/lib/auto-refund";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/cron/auto-refund
 *
 * Only simulated, code-less single-number orders can be swept. Live provider
 * orders must be reconciled manually until cancellation and delivery semantics
 * have been verified; no production refund sweep should be scheduled yet.
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    logger.warn("Unauthorized auto-refund cron attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isPreviewDatabase()) {
    return NextResponse.json({ error: "Live automatic refunds require provider reconciliation" }, { status: 503 });
  }

  try {
    const refunded = await processAutoRefunds();
    logger.info("Auto-refund sweep completed", { refunded });
    return NextResponse.json({ ok: true, refunded });
  } catch (error) {
    logger.error("Auto-refund sweep failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }
}

/** Vercel Cron issues GET requests; treat it identically. */
export const GET = POST;
