import { describe, expect, it } from "vitest";
import { digitalServiceFamily } from "@/lib/services/digital-service-category";
import { reviewedDigitalItems } from "@/lib/services/reviewed-digital-items";

describe("product-purpose grouping, independent of supplier and delivery", () => {
  it.each([
    ["Netflix account", "codes", "accounts"],
    ["Aged Facebook account", "codes", "accounts"],
    ["Instagram followers boost", "topups", "social"],
    ["Telegram SMS verification", "codes", "verification"],
    ["Residential proxies", "codes", "proxies"],
    ["MTN mobile data bundle", "codes", "data"],
    ["US virtual number rental", "codes", "numbers"],
    ["Telegram Stars", "codes", "topups"],
    ["Disney+ 3 months", "codes", "subscriptions"],
    ["NordVPN 12 months", "codes", "subscriptions"],
    ["YouTube Music Family", "topups", "subscriptions"],
    ["CapCut Pro 1 month", "topups", "subscriptions"],
    ["Showmax 30 days", "codes", "subscriptions"],
    ["HBO Max 1 month", "codes", "subscriptions"],
    ["Google One 2TB", "codes", "subscriptions"],
    ["Duolingo Super", "topups", "subscriptions"],
    ["Grok Premium", "topups", "subscriptions"],
    ["Cursor Pro", "codes", "subscriptions"],
    ["Example app annual subscription", "codes", "subscriptions"],
    ["Example subscription gift card", "codes", "gift-cards"],
    ["PUBG Premium currency pack", "topups", "games"],
    ["Unknown Premium product", "codes", null],
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

it("keeps explicitly identified products in one family regardless of supplier shelf", () => {
  for (const shelf of [undefined, "subscriptions", "games", "topups", "gift-cards", "prepaid-finance"]) {
    expect(digitalServiceFamily("Netflix account", "codes", shelf)).toBe("accounts");
    expect(digitalServiceFamily("Netflix Gift Card", "codes", shelf)).toBe("gift-cards");
    expect(digitalServiceFamily("PUBG diamonds", "topups", shelf)).toBe("games");
    expect(digitalServiceFamily("Telegram Stars", "codes", shelf)).toBe("topups");
    expect(digitalServiceFamily("NordVPN 12 months", "codes", shelf)).toBe("subscriptions");
  }
});
