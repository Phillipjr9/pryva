import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), prices: vi.fn() }));
vi.mock("@/lib/identity/auth", () => ({ requireAuthApi: mocks.auth }));
vi.mock("@/lib/platform/rate-limit", () => ({ catalogRateLimiter: mocks.limit }));
vi.mock("@/lib/services/foxreload/telegram-display-prices", () => ({ readTelegramDisplayPrices: mocks.prices }));
import { GET } from "@/app/api/digital/telegram/prices/route";
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ id: "user" }); mocks.limit.mockResolvedValue({ allowed: true }); mocks.prices.mockResolvedValue({ stars: [{ quantity: 50, amount: 2100 }], premium: [{ months: 3, amount: null }] }); });
describe("Telegram display prices route", () => {
  it("requires sign-in and rate limits before fetching", async () => {
    mocks.auth.mockResolvedValueOnce(null); expect((await GET()).status).toBe(401);
    mocks.limit.mockResolvedValueOnce({ allowed: false }); expect((await GET()).status).toBe(429);
    mocks.limit.mockResolvedValueOnce({ unavailable: true }); expect((await GET()).status).toBe(503);
    expect(mocks.prices).not.toHaveBeenCalled();
  });
  it("returns only indicative prices with private no-store caching", async () => {
    const response = await GET(); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true, stars: [{ quantity: 50, amount: 2100 }], premium: [{ months: 3, amount: null }] });
    mocks.prices.mockRejectedValueOnce(new Error("secret supplier failure"));
    const failure = await GET(); expect(failure.status).toBe(503); expect(await failure.text()).not.toContain("secret");
  });
});
