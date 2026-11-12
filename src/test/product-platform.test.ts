import { describe, expect, it } from "vitest";
import { reviewedTopupPlatform } from "@/lib/services/foxreload/product-platform";

const pool = "019e9cf1-b2ba-7a43-ae4f-e04ad8450667";
const oxide = "019e9cf4-df7e-7822-ba2f-a354d1961549";

describe("reviewed top-up identities", () => {
  it("identifies denomination-only products from reviewed categories or explicit slug prefixes", () => {
    expect(reviewedTopupPlatform("20 Cash", "8-ball-pool-20-cash", pool, "direct_topup")).toBe("8 Ball Pool");
    expect(reviewedTopupPlatform("3550 Coins", "fazer-3550-coins", oxide, "direct_topup")).toBe("Oxide: Survival Island");
    expect(reviewedTopupPlatform("80 + 8 CP", "call-of-duty-mobile-activision-us-80-plus-8-cp", "unknown", "direct_topup")).toBe("Call of Duty Mobile");
  });

  it("does not guess from an unknown category, a misleading prefix, a gift card, or a non-top-up", () => {
    expect(reviewedTopupPlatform("20 Cash", "fazer-20-cash", "unknown", "direct_topup")).toBeNull();
    expect(reviewedTopupPlatform("20 Cash", "8-ball-pooler-20-cash", "unknown", "direct_topup")).toBeNull();
    expect(reviewedTopupPlatform("20 Cash", "8-ball-pool-20-cash", "__proto__", "code")).toBeNull();
    expect(reviewedTopupPlatform("8 Ball Pool Partner Gift Card", "8-ball-pool-card", pool, "direct_topup")).toBeNull();
    expect(reviewedTopupPlatform("20 Cash", undefined, { id: pool }, "direct_topup")).toBeNull();
  });

  it("fails closed when a recognized name, slug, and reviewed category disagree", () => {
    expect(reviewedTopupPlatform("20 Cash", "8-ball-pool-20-cash", oxide, "direct_topup")).toBeNull();
    expect(reviewedTopupPlatform("8 Ball Pool Cash", "other", oxide, "direct_topup")).toBeNull();
    expect(reviewedTopupPlatform("PUBG Coins", "8-ball-pool-coins", pool, "direct_topup")).toBeNull();
    expect(reviewedTopupPlatform("Netflix Premium", "call-of-duty-mobile-100-cp", "unknown", "direct_topup")).toBeNull();
  });
});
