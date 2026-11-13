import { describe, expect, it } from "vitest";
import { giftCardDisplayStatus } from "@/lib/services/gift-cards/credit";

/**
 * A gift card's stored status is not always its real one. `active` rows are only
 * ever swept when someone tries to redeem them, so a card whose window closed
 * still reads "active" in the database — and telling a customer that is telling
 * them to try a code that cannot work.
 */
describe("gift-card history status", () => {
  const now = Date.parse("2026-11-12T12:00:00.000Z");

  it("shows a lapsed active card as expired without changing stored values", () => {
    const card = { status: "active", expiresAt: new Date(now - 1) };
    expect(giftCardDisplayStatus(card, now)).toBe("expired");
    expect(card.status).toBe("active");
  });

  it("keeps a card that is still inside its window active", () => {
    expect(giftCardDisplayStatus({ status: "active", expiresAt: new Date(now + 60_000) }, now)).toBe("active");
  });

  it("does not relabel a redeemed card as expired", () => {
    expect(giftCardDisplayStatus({ status: "redeemed", expiresAt: new Date(now - 1) }, now)).toBe("redeemed");
    expect(giftCardDisplayStatus({ status: "cancelled", expiresAt: new Date(now - 1) }, now)).toBe("cancelled");
  });
});
