import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EsimOffer } from "@/lib/services/esim/esim-catalog";

const provider = vi.hoisted(() => ({ buy: vi.fn(), order: vi.fn(), profile: vi.fn(), ambiguous: vi.fn() }));
vi.mock("@/lib/providers/bitcall", () => ({
  buyBitcallEsimPlan: provider.buy,
  getBitcallEsimOrder: provider.order,
  getBitcallEsimProfile: provider.profile,
  isAmbiguousBitcallOutcome: provider.ambiguous,
}));
vi.mock("@/db", () => ({ db: {} }));

import { purchaseEsim, waitForEsimDelivery } from "@/lib/services/esim/esim-fulfilment";

const offer = { id: "live-esim-0123456789abcdef0123", planId: "pln_fixture" } as EsimOffer;
const delivered = { orderId: "ord_accepted", status: "delivered", iccids: ["8901234567890123456"] };

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("eSIM provider recovery", () => {
  it("keeps polling safe when an accepted order's activation profile cannot be read", async () => {
    provider.order.mockResolvedValue(delivered);
    provider.profile.mockRejectedValue(new Error("temporary outage"));
    await expect(waitForEsimDelivery("ord_accepted", 0)).resolves.toBe("pending");
    expect(provider.order).toHaveBeenCalledTimes(1);
    expect(provider.profile).toHaveBeenCalledTimes(1);
  });

  it.each(["cancelled", "refunded", "refund_pending", "failed", "requires_review"])(
    "keeps an accepted %s supplier order for reconciliation instead of asserting no spend",
    async (status) => {
      provider.buy.mockResolvedValue({ orderId: "ord_accepted", status, iccids: [] });
      const save = vi.fn().mockResolvedValue(undefined);
      const outcome = await purchaseEsim(offer, save);
      expect(save).toHaveBeenCalledWith("ord_accepted");
      expect(outcome.kind).toBe("unknown");
      expect(provider.buy).toHaveBeenCalledTimes(1);
      expect(provider.order).not.toHaveBeenCalled();
    },
  );

  it("stops rather than polling if the accepted supplier reference could not be recorded", async () => {
    provider.buy.mockResolvedValue({ orderId: "ord_accepted", status: "pending", iccids: [] });
    const save = vi.fn().mockRejectedValue(new Error("database unavailable"));
    await expect(purchaseEsim(offer, save)).rejects.toThrow("database unavailable");
    expect(provider.order).not.toHaveBeenCalled();
    expect(provider.buy).toHaveBeenCalledTimes(1);
  });
});
