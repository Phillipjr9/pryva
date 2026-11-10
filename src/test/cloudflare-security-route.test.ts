import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), overview: vi.fn() }));
vi.mock("@/lib/identity/admin-auth", () => ({ authorizeAdminApi: mocks.auth }));
vi.mock("@/lib/platform/rate-limit", () => ({ createRateLimiter: () => mocks.limit }));
vi.mock("@/lib/admin/cloudflare-analytics", () => ({ readCloudflareOverview: mocks.overview }));
import { GET } from "@/app/api/admin/security/cloudflare/route";
const req = () => new Request("https://pryva.test/api/admin/security/cloudflare");
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ user: { id: "admin" }, response: null }); mocks.limit.mockResolvedValue({ allowed: true }); mocks.overview.mockResolvedValue({ configured: false, eventLimit: 100 }); });
describe("Cloudflare admin endpoint", () => {
  it("authorizes before rate limit or external access", async () => {
    mocks.auth.mockResolvedValueOnce({ user: null, response: Response.json({ error: "denied" }, { status: 403 }) });
    expect((await GET(req())).status).toBe(403);
    expect(mocks.limit).not.toHaveBeenCalled(); expect(mocks.overview).not.toHaveBeenCalled();
  });
  it("fails closed when the limiter is down or exhausted", async () => {
    mocks.limit.mockResolvedValueOnce({ unavailable: true }); expect((await GET(req())).status).toBe(503);
    mocks.limit.mockResolvedValueOnce({ allowed: false }); expect((await GET(req())).status).toBe(429);
    expect(mocks.overview).not.toHaveBeenCalled();
  });
  it("returns no-store and hides failures", async () => {
    const response = await GET(req()); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    mocks.overview.mockRejectedValueOnce(new Error("secret upstream"));
    const failure = await GET(req()); expect(failure.status).toBe(503); expect(await failure.text()).not.toContain("secret");
  });
});
