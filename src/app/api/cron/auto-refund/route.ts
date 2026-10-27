import { NextRequest, NextResponse } from "next/server";
import { processAutoRefunds } from "@/lib/auto-refund";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/cron/auto-refund
 *
 * Sweeps active orders whose product never arrived and refunds the wallet. The
 * logic lived in `lib/auto-refund.ts` with nothing calling it, which meant the
 * "automatic refund" promise on every product page was never actually kept.
 *
 * Schedule it every 5–10 minutes (Vercel Cron, a systemd timer, or any
 * scheduler that can send an Authorization header).
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    logger.warn("Unauthorized auto-refund cron attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
