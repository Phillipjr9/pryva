import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scheduledOrders } from "@/db/schema";
import { eq, lte, and } from "drizzle-orm";
import { processScheduledOrder } from "@/lib/scheduled-orders";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// POST /api/cron/scheduled-orders - Process due scheduled orders
export async function POST(request: NextRequest) {
  try {
    // Verify cron secret for security
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      logger.warn("Unauthorized cron attempt");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();

    // Find all scheduled orders that are due
    const dueOrders = await db
      .select()
      .from(scheduledOrders)
      .where(
        and(
          eq(scheduledOrders.status, "active"),
          lte(scheduledOrders.nextRunAt, now)
        )
      )
      .limit(50); // Process in batches to avoid overload

    logger.info("Processing scheduled orders", { count: dueOrders.length });

    const results = {
      processed: 0,
      failed: 0,
      skipped: 0,
    };

    for (const scheduled of dueOrders) {
      try {
        if (await processScheduledOrder(scheduled)) results.processed++;
        else results.skipped++;
      } catch (error) {
        logger.error("Failed to process scheduled order", {
          scheduledOrderId: scheduled.id,
          error,
        });
        results.failed++;
      }
    }

    logger.info("Scheduled orders processing complete", results);

    return NextResponse.json({
      ok: true,
      processed: results.processed,
      failed: results.failed,
      skipped: results.skipped,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    logger.error("Cron job failed", { error });
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}
