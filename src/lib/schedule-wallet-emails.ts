import "server-only";
import { after } from "next/server";
import { financialActionsUnavailable } from "@/lib/financial-environment";
import { dispatchWalletEmails, walletEmailConfigured } from "@/lib/wallet-email-outbox";
import { logger } from "@/lib/logger";

/** Trigger a small best-effort batch after the response; the cron retries the durable queue. */
export function scheduleWalletEmails(): void {
  if (financialActionsUnavailable() || !walletEmailConfigured()) return;
  try {
    after(async () => {
      try { await dispatchWalletEmails(); }
      catch { logger.error("Wallet email batch failed; queued jobs will be retried"); }
    });
  } catch {
    // Non-request contexts have no Next.js `after` hook. The scheduled worker
    // still owns the durable queue, so never fail a completed money operation.
    logger.warn("Wallet email batch deferred to the scheduled worker");
  }
}
