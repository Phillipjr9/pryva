import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/auth/demo-web/route";
import { POST as jsonDemo } from "@/app/api/auth/demo/route";

const mocks = vi.hoisted(() => ({ open: vi.fn(), session: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/demo", () => ({ openDemoAccount: mocks.open }));
vi.mock("@/lib/auth", () => ({ createSession: mocks.session }));
vi.mock("@/lib/auth-rate-limit", () => ({ clientIp: () => "203.0.113.5" }));
vi.mock("@/lib/rate-limit", () => ({ demoRateLimiter: mocks.limit }));

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.clearAllMocks();
  mocks.open.mockResolvedValue({ id: "demo-user" });
  mocks.session.mockResolvedValue("a".repeat(64));
  mocks.limit.mockResolvedValue({ allowed: true });
});
afterEach(() => vi.unstubAllEnvs());

describe("public demo endpoints", () => {
  it("bounds form posts and rejects cross-origin and non-form submissions", async () => {
    const form = (body: string, origin = "https://pryva.test", type = "application/x-www-form-urlencoded") => new Request("https://pryva.test/api/auth/demo-web", {
      method: "POST", headers: { origin, "content-type": type }, body,
    });
    const denied = await POST(form("next=%2Fdashboard", "https://evil.pryva.test"));
    expect(denied.status).toBe(403);
    expect(denied.headers.get("content-type")).toContain("text/html");
    expect(denied.headers.get("cache-control")).toBe("no-store");
    expect(await denied.text()).toContain('href="/login"');
    expect((await POST(form("{}", "https://pryva.test", "application/json"))).status).toBe(415);
    expect((await POST(form("x=" + "a".repeat(2048)))).status).toBe(413);
    expect(mocks.open).not.toHaveBeenCalled();
    const response = await POST(form("next=%2Fdashboard%2Forders"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/dashboard/orders");
    expect(mocks.session).toHaveBeenCalledOnce();
  });

  it("offers a no-store bridge only to the current in-memory Arena preview", async () => {
    vi.stubEnv("E2B_SANDBOX_ID", "abc123");
    const request = new Request("http://internal:3100/api/auth/demo-web", {
      method: "POST",
      headers: { host: "3100-abc123.e2b.app", "x-forwarded-proto": "http", origin: "https://3100-abc123.e2b.app", "content-type": "application/x-www-form-urlencoded" },
      body: "next=%2Fdashboard",
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain("/preview-demo-bridge.js");
    expect(mocks.session).toHaveBeenCalledOnce();
  });

  it("limits both demo entry points and never opens a demo in a persistent deployment", async () => {
    mocks.limit.mockResolvedValueOnce({ allowed: false });
    const blocked = await GET(new Request("https://pryva.test/api/auth/demo-web"));
    expect(blocked.headers.get("location")).toBe("/login?error=demo-failed");
    mocks.limit.mockResolvedValueOnce({ allowed: false });
    expect((await jsonDemo(new Request("https://pryva.test/api/auth/demo", { method: "POST" }))).status).toBe(429);
    vi.stubEnv("DATABASE_URL", "postgres://production/db");
    expect((await jsonDemo(new Request("https://pryva.test/api/auth/demo", { method: "POST" }))).status).toBe(403);
    expect((await GET(new Request("https://pryva.test/api/auth/demo-web"))).headers.get("location")).toBe("/login?error=demo-failed");
    expect(mocks.open).not.toHaveBeenCalled();
  });
});
