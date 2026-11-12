import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), configured: vi.fn(), plans: vi.fn(), snapshot: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/identity/auth", () => ({ requireAuthApi: mocks.auth }));
vi.mock("@/lib/providers/clubkonnect", () => ({ isClubkonnectConfigured: mocks.configured, listClubkonnectPlans: mocks.plans }));
vi.mock("@/lib/platform/shared-snapshot", () => ({ readSharedSnapshot: mocks.snapshot }));
vi.mock("@/lib/platform/rate-limit", () => ({ catalogRateLimiter: mocks.limit }));
import { GET, maxDuration } from "@/app/api/airtime/plans/route";
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllEnvs(); });
describe("live data catalogue route", () => {
  it("requires authentication", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
  it("requires configured credentials", async () => {
    mocks.auth.mockResolvedValue({ id: "u" });
    mocks.configured.mockReturnValue(false);
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toMatchObject({ code: "unconfigured" });
  });
  it("provides a cooldown when the browser has hit its rate limit", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    mocks.auth.mockResolvedValue({ id: "u" });
    mocks.configured.mockReturnValue(true);
    mocks.limit.mockResolvedValue({ allowed: false, resetTime: 1_045_000 });
    const response = await GET();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("45");
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
  it("allows a cold shared-snapshot waiter to complete within the route duration", () => {
    expect(maxDuration).toBe(60);
  });
  it("publishes shared supplier listings with original timestamp and explicit checkout status", async () => {
    vi.stubEnv("CLUBKONNECT_USER_ID", "private-account");
    mocks.auth.mockResolvedValue({ id: "u" });
    mocks.configured.mockReturnValue(true);
    mocks.limit.mockResolvedValue({ allowed: true });
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-11T00:01:00Z"));
    mocks.snapshot.mockResolvedValue({ value: [{ id: "clubkonnect:01:4", stock: null }], refreshedAt: "2026-11-11T00:00:00Z", stale: true });
    const response = await GET();
    const body = await response.json();
    expect(body).toMatchObject({ stale: true, checkedAt: "2026-11-11T00:00:00Z", checkoutAvailable: false, priceKind: "supplier-published" });
    expect(body.plans).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("private-account");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.snapshot.mock.calls[0][0].key).not.toContain("private-account");
  });
  it("does not expose or log supplier errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("CLUBKONNECT_USER_ID", "private-account");
    mocks.auth.mockResolvedValue({ id: "u" });
    mocks.configured.mockReturnValue(true);
    mocks.limit.mockResolvedValue({ allowed: true });
    mocks.snapshot.mockRejectedValue(new Error("APIKey=secret"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(await response.text()).not.toContain("secret");
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret|private-account/);
  });
});
