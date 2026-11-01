import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alertText, alertsConfigured, redactContext, resetAlertThrottle, sendAlert } from "@/lib/alerts";

/**
 * Error reporting.
 *
 * The app logs to stdout, which means a failed payout is visible only to somebody
 * reading the platform log at that moment. `logger.error` now posts to a webhook
 * as well — fire-and-forget, throttled, redacted, and incapable of throwing into
 * the handler that was already dealing with a failure.
 */

let posts: { url: string; body: { text?: string } }[] = [];
let reply: () => Response = () => ({ ok: true, status: 200 }) as Response;

beforeEach(() => {
  posts = [];
  reply = () => ({ ok: true, status: 200 }) as Response;
  resetAlertThrottle();
  vi.stubEnv("ALERT_WEBHOOK_URL", "https://hooks.example.com/T000/B000/xyz");
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    posts.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return reply();
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetAlertThrottle();
});

describe("sendAlert", () => {
  it("posts a Slack-compatible body, so no vendor account is needed", async () => {
    expect(await sendAlert("Nightly step failed: auto-refund", { step: "auto-refund" })).toBe(true);
    expect(posts).toHaveLength(1);
    expect(posts[0].body.text).toContain("Pryva: Nightly step failed: auto-refund");
    expect(posts[0].body.text).toContain("auto-refund");
  });

  it("is inert when no webhook is configured, and says so", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "");
    expect(alertsConfigured()).toBe(false);
    expect(await sendAlert("anything")).toBe(false);
    expect(posts).toHaveLength(0);
  });

  it("sends one alert per message per window, so a failing loop cannot flood", async () => {
    await sendAlert("Withdrawal send failed");
    await sendAlert("Withdrawal send failed");
    await sendAlert("Withdrawal send failed");
    expect(posts).toHaveLength(1);
    expect(await sendAlert("A different failure")).toBe(true);
    expect(posts).toHaveLength(2);
  });

  it("never throws, because it runs inside a handler already holding an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("webhook unreachable");
    }));
    await expect(sendAlert("kaboom")).resolves.toBe(false);
  });

  it("reports a rejected post instead of claiming it went out", async () => {
    reply = () => ({ ok: false, status: 500 }) as Response;
    expect(await sendAlert("rejected")).toBe(false);
  });
});

describe("redaction", () => {
  it("strips anything that looks like a credential or an account number", () => {
    const safe = redactContext({
      userId: "u1",
      apiKey: "sk_live_x",
      authorization: "Bearer abc",
      password: "hunter2",
      accountNumber: "0123456789",
      nested: { token: "abc", reason: "mismatch" },
    });
    expect(safe).toEqual({
      userId: "u1",
      apiKey: "[redacted]",
      authorization: "[redacted]",
      password: "[redacted]",
      accountNumber: "[redacted]",
      nested: { token: "[redacted]", reason: "mismatch" },
    });
  });

  it("bounds a long string so one alert cannot be megabytes", () => {
    const safe = redactContext({ detail: "x".repeat(2_000) }) as { detail: string };
    expect(safe.detail.length).toBeLessThan(600);
    expect(safe.detail.endsWith("…")).toBe(true);
  });

  it("is what the posted text is built from", () => {
    const text = alertText("Provider call failed", { apiKey: "sk_live_x", orderId: "o1" });
    expect(text).not.toContain("sk_live_x");
    expect(text).toContain("o1");
  });
});

describe("logger integration", () => {
  it("forwards logger.error to the webhook when one is configured", async () => {
    const { logger } = await import("@/lib/logger");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logger.error("Cron job failed", { step: "daily-reconciliation" });
    // The forward is fire-and-forget: give the dynamic import its turn.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(posts.length).toBe(1);
    expect(posts[0].body.text).toContain("Cron job failed");
    spy.mockRestore();
  });
});
