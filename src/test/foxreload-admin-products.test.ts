import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), limiter: vi.fn(), configured: vi.fn(), browse: vi.fn(), product: vi.fn() }));
vi.mock("@/lib/identity/admin-auth", () => ({ authorizeAdminApi: mocks.auth }));
vi.mock("@/lib/platform/rate-limit", () => ({ createRateLimiter: () => mocks.limiter }));
vi.mock("@/lib/providers/foxreload", () => ({ isFoxreloadConfigured: mocks.configured, readFoxreloadBrowsePage: mocks.browse, readFoxreloadProductContract: mocks.product }));
import { GET } from "@/app/api/admin/foxreload/products/route";
const id = `product_${"a".repeat(26)}`;
const request = (query: string) => new Request(`https://example.test/api/admin/foxreload/products${query}`);
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ user: { id: "admin" }, response: null }); mocks.limiter.mockResolvedValue({ allowed: true }); mocks.configured.mockReturnValue(true); });
describe("admin supplier product review", () => {
  it("checks admin permission, request validation and rate limits before supplier access", async () => {
    mocks.auth.mockResolvedValueOnce({ user: null, response: Response.json({ error: "denied" }, { status: 403 }) });
    expect((await GET(request("?q=game"))).status).toBe(403);
    expect((await GET(request("?q=x"))).status).toBe(400);
    expect((await GET(request("?id=../../bad"))).status).toBe(400);
    expect((await GET(request(`?q=game&id=${id}`))).status).toBe(400);
    mocks.limiter.mockResolvedValueOnce({ allowed: false });
    expect((await GET(request("?q=game"))).status).toBe(429);
    expect(mocks.browse).not.toHaveBeenCalled(); expect(mocks.product).not.toHaveBeenCalled();
  });
  it("searches without returning wholesale data or raw supplier fields", async () => {
    mocks.browse.mockResolvedValue({ rows: [{ id, name: " Game\nVoucher ", price: "secret-price", userGuide: "private" }, { id, name: "duplicate" }, { id: "bad", name: "ignored" }], searchLimited: true });
    const response = await GET(request("?q=Game"));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true, items: [{ id, name: "Game Voucher" }], searchLimited: true });
    expect(mocks.browse).toHaveBeenCalledWith({ query: "Game" });
  });
  it("reads a selected product through the strict contract parser", async () => {
    mocks.product.mockResolvedValue({ id, name: "Game", deliveryType: "code", currency: "usd" });
    expect(await (await GET(request(`?id=${id}`))).json()).toEqual({ ok: true, product: { id, name: "Game", deliveryType: "code", currency: "usd" } });
    expect(mocks.product).toHaveBeenCalledWith(id);
    mocks.product.mockRejectedValueOnce(new Error("private credentials"));
    const response = await GET(request(`?id=${id}`));
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("private");
  });
});
