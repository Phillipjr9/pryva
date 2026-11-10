import { describe, expect, it } from "vitest";
import { cheapestVerifiedGiftCards, type ExplorerItem } from "@/lib/services/service-explorer";
import { legacyGiftCardItems } from "@/lib/services/gift-cards/explorer-items";

const item = (id: string, price: number | null, key: string | undefined, extra: Partial<ExplorerItem> = {}): ExplorerItem => ({
  id, name: "Example gift card", category: "gift-cards", description: "Gift card", tag: "Gift card",
  artwork: { kind: "service", name: "gift-cards" }, source: "catalog", coverage: "unconfirmed", stock: null, myUnits: null,
  price, giftCardEquivalenceKey: key, action: { label: "Review", href: `/${id}` }, ...extra,
});

describe("gift-card catalogue", () => {
  it("keeps the least expensive orderable offer for verified identical terms", () => {
    const offers = [item("high", 2000, "brand:US:USD:10"), item("low", 1500, "brand:US:USD:10"), item("tie", 1500, "brand:US:USD:10"), item("uk", 1000, "brand:UK:USD:10"), item("other amount", 1200, "brand:US:USD:25")];
    expect(cheapestVerifiedGiftCards(offers).map((x) => x.id)).toEqual(["low", "uk", "other amount"]);
  });
  it("never hides unpriced, unverified, price-from, or unavailable offers", () => {
    const offers = [item("price", 500, "a"), item("unknown", null, "a"), item("unverified", 300, undefined), item("from", 100, "a", { priceFrom: true }), item("paused", 50, "a", { orderingPaused: true }), item("no action", 40, "a", { action: null })];
    expect(cheapestVerifiedGiftCards(offers)).toEqual(offers);
  });
  it("exposes legacy offers only when enabled and retains the original checkout", () => {
    expect(legacyGiftCardItems(false)).toEqual([]);
    const offer = legacyGiftCardItems(true).find((x) => x.id === "legacy-gift-steam-usd-10");
    expect(offer).toMatchObject({ category: "gift-cards", price: 16500, action: { href: "/dashboard/gift-cards/brand?denomination=steam-usd-10" } });
  });
});
