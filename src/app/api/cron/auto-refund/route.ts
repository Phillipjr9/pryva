import { NextRequest, NextResponse } from "next/server";
import { processAutoRefunds } from "@/lib/auto-refund";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/cron/auto-refund
 *
 * Sweeps single-verification number orders that timed out with no code and
 * credits the wallet, then releases the number upstream on a best-effort basis.
 * Rentals are deliberately out of scope — no upstream cancel exists for them, so
 * they stay with support for manual reconciliation.
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    logger.warn("Unauthorized auto-refund cron attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { refunded, cancelled } = await processAutoRefunds();
    logger.info("Auto-refund sweep completed", { refunded, cancelled });
    return NextResponse.json({ ok: true, refunded, cancelled });
  } catch (error) {
    logger.error("Auto-refund sweep failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }
}

/** Vercel Cron issues GET requests; treat it identically. */
export const GET = POST;
