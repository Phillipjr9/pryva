import { describe, expect, it } from "vitest";
import { digitalServiceFamily } from "@/lib/services/digital-service-category";
import { reviewedDigitalItems } from "@/lib/services/reviewed-digital-items";

describe("product-purpose grouping, independent of supplier and delivery", () => {
  it.each([
    ["Disney+ 3 months", "codes", "subscriptions"],
    ["Apple Music 1 month", "codes", "subscriptions"],
    ["Netflix 1 month", "codes", "subscriptions"],
    ["Telegram Premium 3 months", "topups", "subscriptions"],
    ["Discord Nitro", "codes", "subscriptions"],
    ["Xbox Game Pass Ultimate", "codes", "subscriptions"],
    ["Call of Duty Mobile CP", "topups", "games"],
    ["Mobile Legends diamonds", "topups", "games"],
    ["Valorant points", "codes", "games"],
    ["Roblox Gift Card", "codes", "gift-cards"],
    ["Steam Wallet 10 USD", "codes", "gift-cards"],
    ["Google Play credit", "codes", "gift-cards"],
    ["Telegram Stars", "topups", "topups"],
    ["Visa card", "codes", "prepaid"],
    ["France eSIM", "esims", "esim"],
    ["Unknown code", "codes", null],
  ] as const)("groups %s under %s's product purpose", (name, kind, expected) => {
    expect(digitalServiceFamily(name, kind)).toBe(expected);
  });
  it("uses the same family for reviewed offers and browse results, not the delivery type", () => {
    const items = reviewedDigitalItems([
      { id: "sub", name: "Spotify Premium", region: "US", kind: "codes" },
      { id: "game", name: "Free Fire diamonds", region: "Global", kind: "topups" },
    ], false);
    expect(items.map((item) => item.category)).toEqual(["subscriptions", "games"]);
    expect(items.map((item) => item.action?.href)).toEqual(["/dashboard/digital-codes?product=sub", "/dashboard/digital-topups?product=game"]);
    expect(digitalServiceFamily("Free Fire diamonds", "topups", "topups")).toBe("games");
    expect(digitalServiceFamily("Generic title", undefined, "subscriptions")).toBe("subscriptions");
  });
});
