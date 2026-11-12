import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), preview: vi.fn(), rate: vi.fn(), configured: vi.fn(), children: vi.fn() }));
vi.mock("@/lib/identity/auth", () => ({ requireAuthApi: mocks.auth }));
vi.mock("@/lib/platform/financial-environment", () => ({ financialActionsUnavailable: mocks.preview }));
vi.mock("@/lib/platform/rate-limit", () => ({ catalogRateLimiter: mocks.rate }));
vi.mock("@/lib/providers/foxreload", () => ({ isFoxreloadConfigured: mocks.configured, readFoxreloadCategoryChildren: mocks.children }));
import { GET } from "@/app/api/services/digital-catalog/subcategories/route";
const request = (query: string) => new NextRequest(`https://example.test/api/services/digital-catalog/subcategories${query}`);
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockResolvedValue({ id: "u" }); mocks.preview.mockReturnValue(false); mocks.rate.mockResolvedValue({ allowed: true }); mocks.configured.mockReturnValue(true);
});
describe("catalogue child categories", () => {
  it("requires auth, validates parameters and rate limits", async () => {
    mocks.auth.mockResolvedValueOnce(null); expect((await GET(request("?parent=games"))).status).toBe(401);
    expect((await GET(request("?parent=../test"))).status).toBe(400);
    expect((await GET(request("?parent=test-orders"))).status).toBe(400);
    expect((await GET(request(`?parent=games&cursor=${"x".repeat(513)}`))).status).toBe(400);
    mocks.rate.mockResolvedValueOnce({ allowed: false }); expect((await GET(request("?parent=games"))).status).toBe(429);
    expect(mocks.children).not.toHaveBeenCalled();
  });
  it("includes the remaining cooldown on a throttled request", async () => {
    const now = Date.now();
    mocks.rate.mockResolvedValueOnce({ allowed: false, resetTime: now + 45_000 });
    const response = await GET(request("?parent=games"));
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThanOrEqual(44);
    expect(mocks.children).not.toHaveBeenCalled();
  });
  it("sanitizes and paginates direct children", async () => {
    mocks.children.mockResolvedValueOnce({ rows: [{ slug: "topups-call-of-duty", name: "Call of Duty", price: "secret" }, { slug: "bad/slash", name: "Bad" }, { slug: "topups-call-of-duty", name: "Duplicate" }], nextCursor: "next" });
    const result = await GET(request("?parent=topups&name=Call%20of%20Duty&cursor=old"));
    expect(await result.json()).toEqual({ ok: true, categories: [{ id: "topups-call-of-duty", name: "Call of Duty" }], nextCursor: "next" });
    expect(mocks.children).toHaveBeenCalledWith({ parent: "topups", name: "Call of Duty", cursor: "old" });
  });
  it("does not expose supplier errors", async () => {
    mocks.children.mockRejectedValueOnce(new Error("secret")); const result = await GET(request("?parent=topups"));
    expect(result.status).toBe(503); expect(await result.text()).not.toContain("secret");
  });
});
