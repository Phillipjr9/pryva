import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const work = vi.hoisted(() => vi.fn());
// A preview must return before any of the background tasks can query or change
// a shared database, contact a supplier, process payouts, or send email.
vi.mock("@/lib/daily-reconciliation", () => ({ lagosDay: work, runDailyReconciliation: work }));
vi.mock("@/lib/auto-refund", () => ({ processAutoRefunds: work }));
vi.mock("@/lib/number-code-sync", () => ({ sweepPendingNumberCodes: work }));
vi.mock("@/lib/wallet-email-outbox", () => ({ dispatchWalletEmails: work, walletEmailConfigured: () => true }));
vi.mock("@/lib/boost-status", () => ({ sweepBoostDeliveries: work }));
vi.mock("@/lib/rental-expiry", () => ({ expireFinishedRentals: work }));
vi.mock("@/lib/scheduled-orders", () => ({ runScheduledOrders: work }));
vi.mock("@/lib/esim-fulfilment", () => ({ sweepPendingEsimOrders: work }));
vi.mock("@/lib/referrals", () => ({ settleReferralRewards: work }));
vi.mock("@/lib/retention", () => ({ purgeExpiredClosedAccounts: work }));
vi.mock("@/lib/payouts", () => ({ reconcileInFlightPayouts: work }));
vi.mock("@/lib/webhook-events", () => ({ pruneWebhookEvents: work }));
vi.mock("@/lib/onboarding-emails", () => ({ backfillOnboardingEmails: work }));

import { GET as nightly } from "@/app/api/cron/nightly/route";
import { GET as autoRefund } from "@/app/api/cron/auto-refund/route";
import { GET as daily } from "@/app/api/cron/daily-reconciliation/route";
import { GET as scheduled } from "@/app/api/cron/scheduled-orders/route";
import { GET as walletEmails } from "@/app/api/cron/wallet-emails/route";

const routes = { nightly, autoRefund, daily, scheduled, walletEmails };

afterEach(() => {
  vi.unstubAllEnvs();
  work.mockClear();
});

describe("preview cron isolation", () => {
  it.each(Object.entries(routes))("%s checks authorization, then refuses work in Vercel preview", async (_name, handler) => {
    // This is a syntactically valid test URL; all job functions are mocked and
    // the guard must run before any could access a persistent connection.
    vi.stubEnv("DATABASE_URL", "postgres://mock.invalid/db");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("CRON_SECRET", "test-secret");
    const noAuth = new NextRequest("https://example.test/api/cron");
    const authorized = new NextRequest("https://example.test/api/cron", { headers: { authorization: "Bearer test-secret" } });
    expect((await handler(noAuth)).status).toBe(401);
    expect((await handler(authorized)).status).toBe(503);
    expect(work).not.toHaveBeenCalled();
  });
});
