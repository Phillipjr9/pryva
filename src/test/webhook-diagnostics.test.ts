import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * "Is the webhook arriving?"
 *
 * Three states have three different fixes, and telling them apart from outside is
 * impossible: nothing arrives, the endpoint works but no payout event is
 * subscribed, or everything is fine. This endpoint has to name the right one, and it
 * must never resend, retry or apply anything.
 */

const state = vi.hoisted(() => ({
  authorized: true,
  preview: false,
  verdict: "receiving" as "receiving" | "only_topups" | "silent",
  throws: false,
}));

vi.mock("@/lib/diagnostics-auth", () => ({ diagnosticsAuthorized: () => state.authorized }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/demo-policy", () => ({ isPreviewDatabase: () => state.preview }));
vi.mock("@/lib/webhook-events", () => ({
  recentWebhookActivity: async () => {
    if (state.throws) throw new Error("database down");
    return {
      windowHours: 168,
      verdict: state.verdict,
      explanation:
        state.verdict === "silent"
          ? "No signed delivery has been recorded in this window."
          : state.verdict === "only_topups"
            ? "Top-ups are arriving but no transfer event has been seen."
            : "Signed deliveries are arriving, including payout events.",
      lastDeliveryAt: state.verdict === "silent" ? null : new Date("2026-10-31T10:00:00.000Z"),
      counts: state.verdict === "silent" ? {} : { "transfer.success": 2 },
      refusedSignatures: 0,
      latest: [],
    };
  },
}));

const { GET } = await import("@/app/api/diagnostics/webhooks/route");

const request = () => new NextRequest("https://pryva.test/api/diagnostics/webhooks", { headers: { authorization: "Bearer test" } });

beforeEach(() => {
  state.authorized = true;
  state.preview = false;
  state.verdict = "receiving";
  state.throws = false;
});

describe("the webhook delivery read-out", () => {
  it("refuses an unauthenticated caller", async () => {
    state.authorized = false;
    expect((await GET(request())).status).toBe(401);
  });

  it("says preview on a deployment with no database", async () => {
    state.preview = true;
    expect((await (await GET(request())).json()).verdict).toBe("preview");
  });

  it("reports receiving when payout events are arriving", async () => {
    const body = await (await GET(request())).json();
    expect(body).toMatchObject({ verdict: "receiving", counts: { "transfer.success": 2 } });
    expect(body.lastDeliveryAt).toBeTruthy();
  });

  it("separates 'the endpoint works' from 'payouts arrive'", async () => {
    state.verdict = "only_topups";
    const body = await (await GET(request())).json();
    expect(body.verdict).toBe("only_topups");
    expect(body.explanation).toContain("no transfer event");
  });

  it("names silence as silence", async () => {
    state.verdict = "silent";
    const body = await (await GET(request())).json();
    expect(body).toMatchObject({ verdict: "silent", lastDeliveryAt: null });
  });

  it("does not fail when the log cannot be read", async () => {
    state.throws = true;
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect((await response.json()).verdict).toBe("unreachable");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("is read-only: the route never writes, resends or applies anything", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/app/api/diagnostics/webhooks/route.ts", "utf8"),
    );
    expect(source).not.toContain("recordWebhookEvent");
    expect(source).not.toContain("settleTransferEvent");
    expect(source).not.toContain("insert(");
    expect(source).not.toContain("delete(");
  });
});
