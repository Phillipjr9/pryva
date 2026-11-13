import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), configured: vi.fn(), plans: vi.fn(), catalogue: vi.fn(), snapshot: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/identity/auth", () => ({ requireAuthApi: mocks.auth }));
vi.mock("@/lib/providers/clubkonnect", async () => {
  // The route distinguishes a refused account from an outage by class, so the
  // mock has to provide that class rather than a plain Error.
  class ClubkonnectAccountError extends Error {
    readonly code: string;
    constructor(code: string) { super("refused"); this.code = code; }
  }
  return {
    ClubkonnectAccountError,
    isClubkonnectCatalogueConfigured: mocks.configured,
    listClubkonnectCatalogue: mocks.catalogue,
    listClubkonnectPlans: mocks.plans,
  };
});
vi.mock("@/lib/platform/shared-snapshot", () => ({ readSharedSnapshot: mocks.snapshot }));
vi.mock("@/lib/platform/rate-limit", () => ({ catalogRateLimiter: mocks.limit }));
import { GET, maxDuration } from "@/app/api/airtime/plans/route";
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllEnvs(); });

const plan = { id: "clubkonnect:01:4", network: "MTN", networkCode: "01", productCode: "4", name: "1GB", publishedAmountKobo: 41000, dataType: "SME", stock: null };

describe("live data catalogue route", () => {
  it("requires authentication", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
  it("requires a configured account identifier", async () => {
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
    mocks.snapshot.mockResolvedValue({ value: { plans: [plan], skipped: 0, emptyNetworks: [] }, refreshedAt: "2026-11-11T00:00:00Z", stale: true });
    const response = await GET();
    const body = await response.json();
    expect(body).toMatchObject({
      stale: true, checkedAt: "2026-11-11T00:00:00Z", checkoutAvailable: false,
      priceKind: "supplier-published", incomplete: false, skipped: 0, emptyNetworks: [],
    });
    expect(body.plans).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("private-account");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.snapshot.mock.calls[0][0].key).not.toContain("private-account");
  });
  it("reports a partial catalogue instead of presenting it as complete", async () => {
    vi.stubEnv("CLUBKONNECT_USER_ID", "private-account");
    mocks.auth.mockResolvedValue({ id: "u" });
    mocks.configured.mockReturnValue(true);
    mocks.limit.mockResolvedValue({ allowed: true });
    mocks.snapshot.mockResolvedValue({
      value: { plans: [plan], skipped: 2, emptyNetworks: ["Glo"] },
      refreshedAt: new Date().toISOString(), stale: false,
    });
    const body = await (await GET()).json();
    expect(body).toMatchObject({ incomplete: true, skipped: 2, emptyNetworks: ["Glo"] });
  });
  it("still serves a catalogue published before this route reported completeness", async () => {
    // A deploy must not turn the existing snapshot — a bare array — into a 503.
    vi.stubEnv("CLUBKONNECT_USER_ID", "private-account");
    mocks.auth.mockResolvedValue({ id: "u" });
    mocks.configured.mockReturnValue(true);
    mocks.limit.mockResolvedValue({ allowed: true });
    mocks.snapshot.mockResolvedValue({ value: [plan], refreshedAt: new Date().toISOString(), stale: false });
    const body = await (await GET()).json();
    expect(body.plans).toHaveLength(1);
    expect(body).toMatchObject({ incomplete: false, skipped: 0, emptyNetworks: [] });
    expect(body.checkoutAvailable).toBe(false);
  });
  it("keeps serving the last complete catalogue for hours rather than empty pages", async () => {
    // The snapshot refreshes every minute; exceeding half an hour means the read is
    // failing. Withholding the last complete copy replaced listings with an error
    // that retrying could not clear, so the ceiling is now generous and the copy
    // still says the listings may have changed.
    vi.stubEnv("CLUBKONNECT_USER_ID", "private-account");
    mocks.auth.mockResolvedValue({ id: "u" });
    mocks.configured.mockReturnValue(true);
    mocks.limit.mockResolvedValue({ allowed: true });
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60_000).toISOString();
    mocks.snapshot.mockResolvedValue({ value: { plans: [plan], skipped: 0, emptyNetworks: [] }, refreshedAt: fiveHoursAgo, stale: true });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ stale: true, checkedAt: fiveHoursAgo });
  });
  it("refuses a week-old snapshot rather than presenting an ancient price as current", async () => {
    vi.stubEnv("CLUBKONNECT_USER_ID", "private-account");
    mocks.auth.mockResolvedValue({ id: "u" });
    mocks.configured.mockReturnValue(true);
    mocks.limit.mockResolvedValue({ allowed: true });
    mocks.snapshot.mockResolvedValue({
      value: { plans: [plan], skipped: 0, emptyNetworks: [] },
      refreshedAt: new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString(), stale: true,
    });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");
  });
  it("does not raise a refresh when the shared snapshot is complete", async () => {
    vi.stubEnv("CLUBKONNECT_USER_ID", "private-account");
    mocks.auth.mockResolvedValue({ id: "u" });
    mocks.configured.mockReturnValue(true);
    mocks.limit.mockResolvedValue({ allowed: true });
    mocks.snapshot.mockResolvedValue({ value: { plans: [plan], skipped: 0, emptyNetworks: [] }, refreshedAt: new Date().toISOString(), stale: false });
    await GET();
    expect(mocks.catalogue).not.toHaveBeenCalled();
  });
  it("tells a refused account apart from an outage, and never leaks the status word", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("CLUBKONNECT_USER_ID", "private-account");
    mocks.auth.mockResolvedValue({ id: "u" });
    mocks.configured.mockReturnValue(true);
    mocks.limit.mockResolvedValue({ allowed: true });
    const { ClubkonnectAccountError } = await import("@/lib/providers/clubkonnect");
    mocks.snapshot.mockRejectedValue(new ClubkonnectAccountError("INVALID_CREDENTIALS"));
    const response = await GET();
    // `unconfigured` is the existing non-retryable state: a refresh button that
    // can never succeed must not be offered.
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "unconfigured" });
    const text = JSON.stringify(warn.mock.calls);
    expect(text).not.toContain("private-account");
    expect(text).toContain("account_rejected");
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
