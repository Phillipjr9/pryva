import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ begin: vi.fn(), quote: vi.fn(), buy: vi.fn() }));
vi.mock("@/lib/checkout/purchase", () => ({ beginPurchase: mocks.begin }));
vi.mock("@/lib/services/foxreload/topup-orders", () => ({ quoteTopup: mocks.quote, buyTopup: mocks.buy }));
import { POST as quote } from "@/app/api/digital/topups/quote/route";
import { POST as purchase } from "@/app/api/digital/topups/purchase/route";
const req = () => new Request("https://example.test", { method: "POST" });
beforeEach(() => { vi.clearAllMocks(); mocks.begin.mockResolvedValue({ ok: true, user: { id: "user-1" }, body: { productId: "digital-123", quantity: 2, quoteId: "q", requestId: "r", note: { player_id: "id" } } }); });
describe("direct top-up routes", () => {
  it("uses the shared purchase guard and blocks rejected authentication", async () => {
    mocks.begin.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await quote(req())).status).toBe(401); expect((await purchase(req())).status).toBe(401); expect(mocks.quote).not.toHaveBeenCalled(); expect(mocks.buy).not.toHaveBeenCalled();
  });
  it("binds quote and purchase to the authenticated user and does not expose supplier data", async () => {
    mocks.quote.mockResolvedValue({ kind: "quote", id: "q", name: "Game", region: "US", amount: 100, expiresAt: new Date() });
    const qr = await quote(req()); expect(qr.status).toBe(200); expect(qr.headers.get("cache-control")).toBe("private, no-store"); expect(mocks.quote).toHaveBeenCalledWith("user-1", "digital-123", 2);
    mocks.buy.mockResolvedValue({ kind: "order", id: "o", reference: "TOPUP-1", status: "review", replayed: false });
    const pr = await purchase(req()); expect(pr.status).toBe(202); expect(pr.headers.get("cache-control")).toBe("private, no-store"); expect(mocks.buy).toHaveBeenCalledWith({ userId: "user-1", quoteId: "q", requestId: "r", note: { player_id: "id" } });
  });
  it("hides unexpected upstream errors", async () => {
    mocks.buy.mockRejectedValueOnce(new Error("private supplier info")); const response = await purchase(req()); expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain("private supplier");
  });
});
