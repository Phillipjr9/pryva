import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ begin: vi.fn(), quote: vi.fn(), buy: vi.fn() }));
vi.mock("@/lib/checkout/purchase", () => ({ beginPurchase: mocks.begin }));
vi.mock("@/lib/services/foxreload/esim-orders", () => ({ quoteEsim: mocks.quote, buyEsim: mocks.buy }));
import { POST as quote } from "@/app/api/digital/esims/quote/route";
import { POST as purchase } from "@/app/api/digital/esims/purchase/route";
const req = () => new Request("https://example.test", { method: "POST" });
beforeEach(() => { vi.clearAllMocks(); mocks.begin.mockResolvedValue({ ok: true, user: { id: "user-1" }, body: { productId: "digital-123", quoteId: "q", requestId: "r" } }); });
describe("digital eSIM purchase routes", () => {
  it("uses the shared purchase guard and does not bypass rejected authentication", async () => {
    mocks.begin.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await quote(req())).status).toBe(401); expect((await purchase(req())).status).toBe(401);
    expect(mocks.quote).not.toHaveBeenCalled(); expect(mocks.buy).not.toHaveBeenCalled();
  });
  it("binds the quote and purchase to the authenticated user, without exposing the profile in responses", async () => {
    mocks.quote.mockResolvedValue({ kind: "quote", id: "q", name: "Game key", region: "US", amount: 100, expiresAt: new Date() });
    const qr = await quote(req()); expect(qr.status).toBe(200); expect(qr.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.quote).toHaveBeenCalledWith("user-1", "digital-123");
    mocks.buy.mockResolvedValue({ kind: "order", id: "o", reference: "CODE-1", status: "review", replayed: false });
    const pr = await purchase(req()); expect(pr.status).toBe(202); expect(pr.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.buy).toHaveBeenCalledWith({ userId: "user-1", quoteId: "q", requestId: "r" });
  });
  it("reports changed and uncertain outcomes without leaking supplier errors", async () => {
    mocks.buy.mockResolvedValueOnce({ kind: "error", code: "changed", message: "Terms changed" });
    expect((await purchase(req())).status).toBe(409);
    mocks.buy.mockRejectedValueOnce(new Error("sensitive supplier detail"));
    const response = await purchase(req()); expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain("sensitive");
  });
});
