import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), execute: vi.fn(), transaction: vi.fn(), insert: vi.fn(), values: vi.fn(), limit: vi.fn(),
  log: { warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/db", () => ({ db: { execute: mocks.execute, transaction: mocks.transaction } }));
vi.mock("@/lib/auth", () => ({ requireAuthApi: mocks.user }));
vi.mock("@/lib/auth-rate-limit", () => ({ clientIp: () => "203.0.113.5" }));
vi.mock("@/lib/rate-limit", () => ({ securityReportRateLimiter: mocks.limit }));
vi.mock("@/lib/logger", () => ({ logger: mocks.log }));

import * as health from "@/app/api/health/route";
import * as report from "@/app/api/security/report/route";

function request(body: string, overrides: Record<string, string> = {}) {
  return new NextRequest("https://pryva.test/api/security/report", {
    method: "POST",
    headers: { host: "pryva.test", "x-forwarded-proto": "https", origin: "https://pryva.test", "content-type": "application/json", "user-agent": "actual-browser", ...overrides },
    body,
  });
}

beforeEach(() => {
  mocks.user.mockResolvedValue({ id: "user-1", email: "user@example.com" });
  mocks.limit.mockResolvedValue({ allowed: true, resetTime: Date.now() + 60_000 });
  mocks.values.mockResolvedValue(undefined);
  mocks.insert.mockReturnValue({ values: mocks.values });
  mocks.transaction.mockImplementation(async (callback) => callback({ insert: mocks.insert }));
});

describe("public health endpoint", () => {
  it("reports readiness without business metrics and disables caching", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ "?column?": 1 }] });
    const response = await health.GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(Object.keys(await response.json()).sort()).toEqual(["mode", "status"]);
  });

  it("does not disclose connection errors", async () => {
    mocks.execute.mockRejectedValue(new Error("postgres://user:secret@private-host"));
    const response = await health.GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/secret|private-host/);
  });
});

describe("untrusted client security reports", () => {
  it("rejects cross-origin, non-JSON, oversized, unknown and malformed reports", async () => {
    const valid = JSON.stringify({ violations: ["DevTools detected"] });
    expect((await report.POST(request(valid, { origin: "https://evil.test" }))).status).toBe(403);
    expect((await report.POST(request(valid, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await report.POST(request("x".repeat(9_000)))).status).toBe(413);
    expect((await report.POST(request(JSON.stringify({ violations: Array(11).fill("DevTools detected") })))).status).toBe(400);
    expect((await report.POST(request(JSON.stringify({ violations: ["arbitrary forged event"] })))).status).toBe(400);
    expect((await report.POST(request(JSON.stringify({ violations: ["Scraping detected: x\nINJECT"] })))).status).toBe(400);
    expect((await report.POST(request(JSON.stringify({ violations: ["DevTools detected"], url: "https://evil.test/" })))).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("uses server identity and user agent, and strips secrets from reported URLs", async () => {
    const response = await report.POST(request(JSON.stringify({
      violations: ["DevTools detected", "Scraping detected: too many clicks"],
      userId: "attacker-chosen", userAgent: "spoofed", url: "https://pryva.test/dashboard?token=secret#secret",
    })));
    expect(response.status).toBe(200);
    expect(mocks.values).toHaveBeenCalledTimes(2);
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1", userEmail: "user@example.com", userAgent: "actual-browser", url: "/dashboard", type: "devtools",
    }));
    expect(JSON.stringify(mocks.log.warn.mock.calls)).not.toContain("secret");
  });

  it("fails closed when the rate-limit store is unavailable and caps reports", async () => {
    mocks.limit.mockResolvedValueOnce({ allowed: false, unavailable: true });
    expect((await report.POST(request('{}'))).status).toBe(503);
    mocks.limit.mockResolvedValueOnce({ allowed: false, resetTime: Date.now() + 1000 });
    expect((await report.POST(request('{}'))).status).toBe(429);
  });
});
