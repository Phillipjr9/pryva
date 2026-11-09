import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), configured: vi.fn(), probe: vi.fn(), blocked: vi.fn() }));
vi.mock("@/lib/identity/admin-auth", () => ({ authorizeAdminApi: mocks.auth }));
vi.mock("@/lib/platform/rate-limit", () => ({ createRateLimiter: () => mocks.limit }));
vi.mock("@/lib/platform/financial-environment", () => ({ financialActionsUnavailable: mocks.blocked }));
vi.mock("@/lib/providers/foxreload", () => ({ isFoxreloadConfigured: mocks.configured, probeFoxreloadAccount: mocks.probe, FoxreloadError: class FoxreloadError extends Error { constructor(message: string, public status: number) { super(message); } } }));
import { FoxreloadError } from "@/lib/providers/foxreload";
import { GET } from "@/app/api/admin/foxreload/route";
const request = () => new Request("https://example.test/api/admin/foxreload");
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockResolvedValue({ user: { id: "admin" }, response: null }); mocks.limit.mockResolvedValue({ allowed: true });
  mocks.configured.mockReturnValue(true); mocks.blocked.mockReturnValue(true);
  mocks.probe.mockResolvedValue({ active: true, funds: { usd: "positive", rub: "zero" } });
});
describe("FoxReload admin readiness", () => {
  it("refuses non-admins and rate-limited requests before any provider call", async () => {
    mocks.auth.mockResolvedValueOnce({ user: null, response: Response.json({ error: "denied" }, { status: 403 }) });
    expect((await GET(request())).status).toBe(403);
    mocks.limit.mockResolvedValueOnce({ allowed: false });
    expect((await GET(request())).status).toBe(429);
    mocks.limit.mockResolvedValueOnce({ allowed: false, unavailable: true });
    expect((await GET(request())).status).toBe(503);
    expect(mocks.probe).not.toHaveBeenCalled();
  });
  it("checks account without returning credentials, amounts or profile details", async () => {
    const response = await GET(request());
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.account).toEqual({ active: true, funds: { usd: "positive", rub: "zero" } });
    expect(body.settings.purchasesBlockedInEnvironment).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/private|secret_value|amount/i);
    expect(mocks.probe).toHaveBeenCalledOnce();
  });
  it("never returns provider error text or treats an absent credential as authenticated", async () => {
    mocks.configured.mockReturnValueOnce(false);
    expect(await (await GET(request())).json()).toMatchObject({ configured: false, account: null, error: null });
    expect(mocks.probe).not.toHaveBeenCalled();
    mocks.probe.mockRejectedValueOnce(new FoxreloadError("secret_value private supplier response", 401));
    const body = await (await GET(request())).json();
    expect(body).toMatchObject({ account: null, error: "auth" });
    expect(JSON.stringify(body)).not.toContain("secret_value");
    mocks.probe.mockRejectedValueOnce(new Error("secret_value"));
    expect(await (await GET(request())).json()).toMatchObject({ account: null, error: "unavailable" });
  });
});
