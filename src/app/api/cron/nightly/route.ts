import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { lagosDay, runDailyReconciliation } from "@/lib/daily-reconciliation";
import { processAutoRefunds } from "@/lib/auto-refund";
import { dispatchWalletEmails, walletEmailConfigured } from "@/lib/wallet-email-outbox";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The one scheduled job.
 *
 * Vercel's Hobby plan allows two cron entries; this app needs three tasks. One
 * entry calling all three is not a workaround — it is the better arrangement,
 * because the order is a dependency, not a coincidence:
 *
 *   1. **close yesterday's books** first, before today's auto-refunds write new
 *      ledger rows that would make the close read a moving target;
 *   2. **drain the wallet email outbox**, so the receipts for yesterday go out;
 *   3. **sweep auto-refunds** last, which is the only step that writes money.
 *
 * Each step is isolated: a failure in one is reported and the next still runs,
 * because an email outage must never stop a refund sweep. The old per-task
 * endpoints stay deployed for a manual run (`/api/cron/auto-refund`,
 * `/api/cron/wallet-emails`) — they are simply no longer scheduled.
 */

function authorized(value: string | null): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !value) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(value);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

type Step = { ok: boolean; detail: string };

async function runStep(name: string, step: () => Promise<Step>): Promise<Step> {
  try {
    return await step();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error(`Nightly step failed: ${name}`, { step: name, detail });
    return { ok: false, detail };
  }
}

async function handler(request: NextRequest) {
  if (!authorized(request.headers.get("authorization"))) {
    logger.warn("Unauthorized nightly cron attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const day = request.nextUrl.searchParams.get("day") ?? lagosDayBack();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json({ error: "day must be YYYY-MM-DD" }, { status: 400 });
  }

  const close = await runStep("daily-reconciliation", async () => {
    const result = await runDailyReconciliation(day);
    return {
      ok: result.status === "clean",
      detail: `${result.day}: ${result.status}, ${result.discrepancies} discrepanc(ies), ${result.accountsChecked} accounts`,
    };
  });

  const emails = await runStep("wallet-emails", async () => {
    if (isPreviewDatabase() || !walletEmailConfigured()) {
      return { ok: true, detail: "skipped: email worker not configured" };
    }
    const counts = await dispatchWalletEmails();
    // `retry` and `review` are not failures of the run: the outbox owns them,
    // with its own lease and retry budget.
    return { ok: true, detail: `sent ${counts.sent}, retry ${counts.retry}, review ${counts.review}` };
  });

  const refunds = await runStep("auto-refund", async () => {
    const { refunded, cancelled } = await processAutoRefunds();
    return { ok: true, detail: `refunded ${refunded}, released ${cancelled}` };
  });

  const allOk = close.ok && emails.ok && refunds.ok;
  logger.info("Nightly run finished", { day, allOk, close: close.detail, emails: emails.detail, refunds: refunds.detail });

  return NextResponse.json(
    { ok: allOk, day, steps: { close, emails, refunds } },
    { status: allOk ? 200 : 207, headers: { "Cache-Control": "no-store" } },
  );
}

/** Yesterday in Lagos (UTC+1, no daylight saving), which is the day being closed. */
function lagosDayBack(): string {
  return lagosDay(new Date(Date.now() - 24 * 60 * 60 * 1000));
}

export const GET = handler;
export const POST = handler;
