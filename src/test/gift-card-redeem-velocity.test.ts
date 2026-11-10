import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ velocity: vi.fn(), redeem: vi.fn(), fraud: vi.fn() }));
vi.mock("@/lib/identity/auth", () => ({ requireAuthApi: async () => ({ id: "u1" }) }));
vi.mock("@/lib/platform/financial-environment", () => ({ financialActionsUnavailable: () => false }));
vi.mock("@/lib/platform/net", () => ({ isSameOriginMutation: () => true }));
vi.mock("@/lib/services/gift-cards/credit", () => ({ redeemGiftCard: mocks.redeem }));
vi.mock("@/lib/services/gift-cards/credit-requests", () => ({ giftCardAttemptLimit: async () => null, normalizeGiftCardCode: (code: unknown) => code }));
vi.mock("@/lib/admin/fraud", () => ({ giftCardVelocity: mocks.velocity, recordFraudEvent: mocks.fraud }));
import { POST } from "@/app/api/gift-cards/redeem/route";

const request = () => new NextRequest("https://pryva.test/api/gift-cards/redeem", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "CODE" }),
});
beforeEach(() => { vi.clearAllMocks(); mocks.redeem.mockResolvedValue({ amount: 100 }); });
describe("redemption velocity gate", () => {
  it("fails closed without redeeming if the counter is unavailable", async () => {
    mocks.velocity.mockRejectedValueOnce(new Error("offline"));
    expect((await POST(request())).status).toBe(503);
    expect(mocks.redeem).not.toHaveBeenCalled();
  });
  it("blocks excessive redemptions and allows requests under the limit", async () => {
    mocks.velocity.mockResolvedValueOnce({ allowed: false, count: 10, limit: 10 });
    expect((await POST(request())).status).toBe(429);
    expect(mocks.redeem).not.toHaveBeenCalled();
    mocks.velocity.mockResolvedValueOnce({ allowed: true, count: 0, limit: 10 });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.redeem).toHaveBeenCalledOnce();
  });
});
