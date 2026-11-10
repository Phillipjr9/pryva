import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), preview: vi.fn(), rate: vi.fn(), configured: vi.fn(), categories: vi.fn() }));
vi.mock("@/lib/identity/auth", () => ({ requireAuthApi: mocks.auth }));
vi.mock("@/lib/platform/financial-environment", () => ({ financialActionsUnavailable: mocks.preview }));
vi.mock("@/lib/platform/rate-limit", () => ({ catalogRateLimiter: mocks.rate }));
vi.mock("@/lib/providers/foxreload", () => ({ isFoxreloadConfigured: mocks.configured, readFoxreloadBrowseCategories: mocks.categories }));
import { GET } from "@/app/api/services/digital-catalog/categories/route";
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockResolvedValue({ id: "u1" }); mocks.preview.mockReturnValue(false);
  mocks.configured.mockReturnValue(true); mocks.rate.mockResolvedValue({ allowed: true });
});
describe("digital category browser", () => {
  it("requires authentication and fails closed when unavailable", async () => {
    mocks.auth.mockResolvedValueOnce(null); expect((await GET()).status).toBe(401);
    mocks.preview.mockReturnValueOnce(true); expect((await GET()).status).toBe(503);
    mocks.rate.mockResolvedValueOnce({ unavailable: true }); expect((await GET()).status).toBe(503);
    expect(mocks.categories).not.toHaveBeenCalled();
  });
  it("returns safe root labels, including newly added categories, without prices or supplier metadata", async () => {
    mocks.categories.mockResolvedValue([{ slug: "topups", name: "Other language", inStockCount: 123 }, { slug: "new-category", name: " New \n category ", secret: "hidden" }, { slug: "../bad", name: "Bad" }, { slug: "topups", name: "Duplicate" }]);
    const response = await GET();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true, categories: [{ id: "topups", name: "Account top-ups" }, { id: "new-category", name: "New category" }] });
  });
  it("does not disclose upstream errors", async () => {
    mocks.categories.mockRejectedValue(new Error("secret"));
    const response = await GET(); expect(response.status).toBe(503); expect(await response.text()).not.toContain("secret");
  });
});
