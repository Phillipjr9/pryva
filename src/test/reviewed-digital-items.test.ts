import { describe, expect, it } from "vitest";
import { reviewedDigitalItems } from "@/lib/services/reviewed-digital-items";
import { filterExplorerItems } from "@/lib/services/service-explorer";

describe("reviewed digital offers in the service hub", () => {
  it("retains quote links and groups only known product families", () => {
    const items = reviewedDigitalItems([
      { id: "card", name: "Roblox Gift Card", region: "US", kind: "codes" },
      { id: "code", name: "Unidentified code", region: "Global", kind: "codes" },
      { id: "topup", name: "Game credit", region: "US", kind: "topups" },
      { id: "esim", name: "Travel data", region: "France", kind: "esims" },
    ], true);
    expect(filterExplorerItems(items, "gift-cards", "").map((x) => x.id)).toEqual(["card"]);
    expect(filterExplorerItems(items, "topups", "").map((x) => x.id)).toEqual(["topup", "telegram-stars-featured"]);
    expect(filterExplorerItems(items, "esim", "").map((x) => x.id)).toEqual(["esim"]);
    expect(filterExplorerItems(items, "tools", "")).toEqual([]);
    expect(filterExplorerItems(items, "all", "")).toHaveLength(5);
    expect(items.find((x) => x.id === "card")?.action?.href).toBe("/dashboard/digital-codes?product=card");
    expect(items.find((x) => x.id === "esim")?.action?.href).toBe("/dashboard/digital-esims?product=esim");
    expect(items.every((x) => x.price === null && x.stock === null)).toBe(true);
  });
});
