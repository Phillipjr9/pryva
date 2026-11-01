import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";

/**
 * Recurring orders were a promise nothing kept.
 *
 * The schema, the API and `processScheduledOrder` were all written, and the page
 * said the feature did not exist -- correctly, because no job ever called the
 * processor: `vercel.json` schedules only `/api/cron/nightly`, and the dedicated
 * route answered POST while Vercel Cron sends GET.
 *
 * The wiring is two lines, which is exactly why it needs a test: nothing in the
 * build fails when a cron step is forgotten, and a schedule that silently never
 * runs looks identical to one that has nothing due.
 */

const runScheduledOrders = vi.fn();
vi.mock("@/lib/scheduled-orders", () => ({ runScheduledOrders: (...args: unknown[]) => runScheduledOrders(...args) }));

const { GET, POST } = await import("@/app/api/cron/scheduled-orders/route");

function cronRequest(authorization?: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/cron/scheduled-orders", {
    headers: authorization ? { authorization } : {},
  });
}

describe("/api/cron/scheduled-orders", () => {
  beforeEach(() => {
    runScheduledOrders.mockReset();
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("answers GET, which is the verb Vercel Cron sends", async () => {
    runScheduledOrders.mockResolvedValue({ processed: 0, skipped: 0, failed: 0 });
    const response = await GET(cronRequest("Bearer test-cron-secret"));
    expect(response.status).toBe(200);
  });

  it("refuses a request without the secret, and runs nothing", async () => {
    const response = await GET(cronRequest());
    expect(response.status).toBe(401);
    expect(runScheduledOrders).not.toHaveBeenCalled();
  });

  it("refuses a wrong secret of the same length", async () => {
    const response = await GET(cronRequest("Bearer test-cron-secreT"));
    expect(response.status).toBe(401);
    expect(runScheduledOrders).not.toHaveBeenCalled();
  });

  it("reports all three counts, so a run that did nothing is distinguishable", async () => {
    runScheduledOrders.mockResolvedValue({ processed: 1, skipped: 2, failed: 3 });
    const response = await GET(cronRequest("Bearer test-cron-secret"));
    expect(await response.json()).toMatchObject({ ok: true, processed: 1, skipped: 2, failed: 3 });
  });

  it("still accepts POST for a manual run", async () => {
    runScheduledOrders.mockResolvedValue({ processed: 2, skipped: 0, failed: 0 });
    const response = await POST(cronRequest("Bearer test-cron-secret"));
    expect(response.status).toBe(200);
  });
});

describe("the nightly job calls the processor", () => {
  const source = readFileSync("src/app/api/cron/nightly/route.ts", "utf8");

  it("imports and runs the schedule sweep", () => {
    expect(source).toContain('import { runScheduledOrders } from "@/lib/scheduled-orders"');
    expect(source).toContain('runStep("scheduled-orders"');
    expect(source).toContain("await runScheduledOrders()");
  });

  it("reports it in the run summary, so a failed step is visible in the cron response", () => {
    expect(source).toContain("scheduled.ok");
    expect(source).toContain("scheduled: scheduled.detail");
    expect(source).toContain("steps: { close, emails, boosts, numberCodes, refunds, esim, scheduled, rentals, referrals, retention }");
  });

  it("runs it after the refund sweep, so an order it creates is not swept by the same run", () => {
    const refunds = source.indexOf('runStep("auto-refund"');
    const scheduled = source.indexOf('runStep("scheduled-orders"');
    expect(refunds).toBeGreaterThan(-1);
    expect(scheduled).toBeGreaterThan(refunds);
  });
});
