import { describe, expect, it } from "vitest";
import { topupArtwork } from "@/lib/services/foxreload/topup-artwork";

const pool = "019e9cf1-b2ba-7a43-ae4f-e04ad8450667";
const oxide = "019e9cf4-df7e-7822-ba2f-a354d1961549";
const direct = "direct_topup";
const art = (key: string) => ({ kind: "category", key });

describe("reviewed top-up category artwork", () => {
  it("distinguishes the generic Oxide listing from the 8 Ball Pool products", () => {
    expect(topupArtwork("3550 Coins (40% more value)", "fazer-3550-coins-40-more-value-0147ab", oxide, direct)).toEqual(art("oxide-survival-island"));
    for (const [name, slug] of [
      ["Golden Spin", "8-ball-pool-golden-spin"],
      ["5 Scratchers", "8-ball-pool-5-scratchers"],
      ["20 000 Coins", "8-ball-pool-20-000-coins"],
      ["20 Cash", "8-ball-pool-20-cash"],
      ["3 Golden Shots", "8-ball-pool-3-golden-shots"],
    ]) expect(topupArtwork(name, slug, pool, direct)).toEqual(art("8-ball-pool"));
    // The same generic name can belong to different games.
    expect(topupArtwork("20 Cash", undefined, oxide, direct)).toEqual(art("oxide-survival-island"));
    expect(topupArtwork("20 Cash", undefined, pool, direct)).toEqual(art("8-ball-pool"));
  });

  it.each([
    ["019e9cf1-b35e-7780-8b01-5070fbd34b2a", "acecraft"],
    ["019e9cf1-b3ee-7471-9197-e6e25ba5cd33", "ace-racer"],
    ["019e9cfe-75d1-71f2-ae82-35bc3d4d7ee0", "ace-racer"],
    ["019e9cf1-b429-7152-aae4-ddd59cb5e450", "afk-journey"],
    ["019e9cf1-b477-7df3-a19a-0ca038fc4336", "age-of-empires-mobile"],
    ["019e9cf1-b51e-7590-a976-6c4aa939559e", "age-of-magic"],
  ])("uses the reviewed game for generic top-ups in category %s", (category, key) => {
    expect(topupArtwork("100 Coins", undefined, category, direct)).toEqual(art(key));
  });

  it("does not guess from unknown categories, amounts, or a requested top-up root", () => {
    expect(topupArtwork("3550 Coins (40% more value)", "fazer-3550-coins", "unknown", direct)).toBeNull();
    expect(topupArtwork("3550 Coins (40% more value)", undefined, "topups", direct)).toBeNull();
    expect(topupArtwork("20 Cash", undefined, "__proto__", direct)).toBeNull();
    expect(topupArtwork("20 Cash", undefined, { id: pool }, direct)).toBeNull();
    // An explicitly recognizable product still works if the category is new.
    expect(topupArtwork("Golden Spin", "8-ball-pool-golden-spin", "new-category", direct)).toEqual(art("8-ball-pool"));
    expect(topupArtwork("Age of Empires Mobile 100 Coins", undefined, "new-category", direct)).toEqual(art("age-of-empires-mobile"));
  });

  it("fails closed on conflicting recognized game identities", () => {
    expect(topupArtwork("8 Ball Pool Cash", undefined, oxide, direct)).toBeNull();
    expect(topupArtwork("20 Cash", "8-ball-pool-20-cash", oxide, direct)).toBeNull();
    expect(topupArtwork("8 Ball Pool Cash", "oxide-survival-island-20-cash", "unknown", direct)).toBeNull();
    expect(topupArtwork("8 Ball Pool Other Brand Gift Card", undefined, pool, direct)).toBeNull();
  });

  it("does not change artwork selection for non-top-up or missing delivery types", () => {
    expect(topupArtwork("3550 Coins (40% more value)", "fazer-3550-coins", oxide, "code")).toBeNull();
    expect(topupArtwork("3550 Coins (40% more value)", "fazer-3550-coins", oxide, undefined)).toBeNull();
    expect(topupArtwork("Netflix Gift Card 20 USD", undefined, oxide, "code")).toEqual({ kind: "brand", key: "netflix" });
  });
});
