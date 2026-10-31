import { describe, expect, it, vi } from "vitest";
import {
  BRAND_GIFT_CARDS,
  getBrandGiftCards,
  findBrandGiftCard,
  findGiftCardDenomination,
} from "@/lib/gift-cards-catalog";
import { GET as getCatalogRoute } from "@/app/api/gift-cards/catalog/route";
import { POST as orderRoute } from "@/app/api/gift-cards/order/route";

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
}));

describe("Brand Gift Cards catalog", () => {
  it("carries all major global gaming and digital retail gift cards", () => {
    const cards = getBrandGiftCards();
    const slugs = cards.map((c) => c.slug);
    expect(slugs).toContain("steam");
    expect(slugs).toContain("apple");
    expect(slugs).toContain("google");
    expect(slugs).toContain("playstation");
    expect(slugs).toContain("xbox");
    expect(slugs).toContain("roblox");
    expect(slugs).toContain("amazon");
    expect(slugs).toContain("razer");
  });

  it("ensures every card has denominations with valid pricing and instructions", () => {
    for (const card of BRAND_GIFT_CARDS) {
      expect(card.name.length).toBeGreaterThan(3);
      expect(card.redemptionGuide.length).toBeGreaterThan(10);
      expect(card.denominations.length).toBeGreaterThanOrEqual(2);

      for (const denom of card.denominations) {
        expect(denom.amountUsd).toBeGreaterThan(0);
        expect(denom.priceNgn).toBeGreaterThan(5000);
        expect(denom.id).toContain(card.slug);
      }
    }
  });

  it("finds denominations correctly by identifier", () => {
    const found = findGiftCardDenomination("steam-usd-10");
    expect(found).toBeDefined();
    expect(found?.card.slug).toBe("steam");
    expect(found?.denomination.amountUsd).toBe(10);
    expect(found?.denomination.priceNgn).toBe(16500);

    expect(findGiftCardDenomination("invalid-card-id")).toBeUndefined();
  });
});

describe("Brand Gift Cards API routes", () => {
  it("GET /api/gift-cards/catalog returns the curated brands and fulfillment status", async () => {
    const response = await getCatalogRoute();
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.cards)).toBe(true);
    expect(data.cards.length).toBeGreaterThanOrEqual(8);
    expect(typeof data.liveFulfillmentConfigured).toBe("boolean");
  });

  it("POST /api/gift-cards/order rejects unauthenticated requests", async () => {
    const request = new Request("https://pryva.test/api/gift-cards/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ denominationId: "steam-usd-10", requestId: "00000000-0000-4000-8000-000000000001" }),
    });

    const response = await orderRoute(request);
    expect(response.status).toBe(401);
  });
});
