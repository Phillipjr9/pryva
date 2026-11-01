import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runScheduledOrders } from "@/lib/scheduled-orders";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Run the schedules that are due.
 *
 * This route exported POST only, and Vercel Cron issues GET — so registering it
 * in vercel.json would have produced a job that was answered 405 forever while
 * looking configured. That is why the schedule lives in `/api/cron/nightly`
 * instead (Hobby allows two cron entries and the app needs three tasks). This
 * route stays deployed for a manual run, and now answers GET as well, so wiring
 * it later cannot silently rot.
 */
function authorized(value: string | null): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !value) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(value);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

async function handler(request: NextRequest) {
  if (!authorized(request.headers.get("authorization"))) {
    logger.warn("Unauthorized cron attempt: scheduled-orders");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  try {
    const counts = await runScheduledOrders();
    logger.info("Scheduled orders run complete", counts);
    return NextResponse.json(
      { ok: true, ...counts, timestamp: now.toISOString() },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logger.error("Scheduled orders run failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
