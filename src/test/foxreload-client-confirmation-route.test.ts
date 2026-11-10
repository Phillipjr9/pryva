import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), preview: vi.fn(), rate: vi.fn(), begin: vi.fn(), inspect: vi.fn(), submit: vi.fn() }));
vi.mock("@/lib/identity/auth", () => ({ requireAuthApi: mocks.auth }));
vi.mock("@/lib/platform/financial-environment", () => ({ financialActionsUnavailable: mocks.preview }));
vi.mock("@/lib/platform/rate-limit", () => ({ createRateLimiter: () => mocks.rate }));
vi.mock("@/lib/checkout/purchase", () => ({ beginPurchase: mocks.begin }));
vi.mock("@/lib/services/foxreload/client-confirmation", () => ({ inspectClientConfirmation: mocks.inspect, submitClientConfirmation: mocks.submit }));
import { GET, POST } from "@/app/api/digital/client-confirmation/route";
const ID = "22222222-2222-4222-8222-222222222222";
const get = () => new Request(`https://example.test/api/digital/client-confirmation?id=${ID}`);
const post = () => new Request("https://example.test/api/digital/client-confirmation", { method: "POST" });
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockResolvedValue({ id: "buyer" }); mocks.preview.mockReturnValue(false); mocks.rate.mockResolvedValue({ allowed: true });
  mocks.begin.mockResolvedValue({ ok: true, user: { id: "buyer" }, body: { orderId: ID, code: "123456" } });
});
describe("confirmation routes", () => {
  it("guards authentication, environment and invalid orders", async () => {
    mocks.auth.mockResolvedValueOnce(null); expect((await GET(get())).status).toBe(401);
    mocks.preview.mockReturnValueOnce(true); expect((await GET(get())).status).toBe(503);
    mocks.begin.mockResolvedValueOnce({ ok: false, response: new Response(null, { status: 403 }) }); expect((await POST(post())).status).toBe(403);
    expect(mocks.inspect).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("exposes only a confirmation flag, not supplier or item identifiers", async () => {
    mocks.inspect.mockResolvedValue({ kind: "waiting", providerId: "secret-provider", itemId: "secret-item" });
    const response = await GET(get()); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true, required: true, blocked: false }); expect(mocks.inspect).toHaveBeenCalledWith("buyer", ID);
  });
  it("returns no private provider error or confirmation code", async () => {
    mocks.submit.mockRejectedValueOnce(new Error("private-code 123456")); const response = await POST(post());
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("123456");
    expect(mocks.submit).toHaveBeenCalledWith("buyer", ID, "123456");
  });
});
