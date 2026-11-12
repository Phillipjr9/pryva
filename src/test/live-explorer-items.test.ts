import { describe, expect, it } from "vitest";
import { readLiveExplorerItems } from "@/lib/services/live-explorer-items";
import { supplierItemsForCountry, type SupplierSnapshot } from "@/lib/services/numbers/fleexa-catalog";
import { bitcallOtpItemsForCountry } from "@/lib/services/numbers/otp-catalog";
import { boostItems, type BoostSnapshot } from "@/lib/services/boosts/smm-catalog";
import { esimItemsForAllDestinations, esimItemsForCountry, type EsimListing } from "@/lib/services/esim/esim-catalog";
import type { ExplorerItem } from "@/lib/services/service-explorer";

const esim: EsimListing = {
  id: "esim-0123456789abcdef0123", planId: "private-plan", name: "Nigeria Lite", region: "Africa", countries: ["Nigeria"],
  dataLabel: "1 GB", validityLabel: "7 days", coverage: "catalog-country", includesPhoneNumber: null,
  supportsVoice: null, supportsSms: null, priceNgn: 1500, purchasable: true,
};
const supplier: SupplierSnapshot = {
  email: [{ id: "private-inbox", name: "Gmail inbox", domain: "gmail.com", priceNgn: null, stock: 7 }],
  rentals: [{ id: "private-rental", country: "Nigeria", pricePerMonthNgn: 3000, stock: 2 }],
  partial: false, degraded: null, fetchedAt: "2026-11-12T12:00:00.000Z",
};
const boosting: BoostSnapshot = {
  services: [{ id: "private-boost", name: "Instagram Followers", category: "Instagram - Followers", type: "Default",
    ratePer1000: 1500, currency: "NGN", min: 100, max: 10000, refill: true, cancel: true, dripfeed: false }],
  currency: "NGN", balance: 10, balanceUnavailable: false, partial: false, degraded: null, fetchedAt: "2026-11-12T12:00:00.000Z",
};

function parsed(items: ExplorerItem[], categories: string[]) {
  // Exercise the exact shape crossing the JSON API, including omitted fields.
  const json = JSON.parse(JSON.stringify(items)) as unknown[];
  return readLiveExplorerItems(json, categories, "ng");
}

describe("live listing presentation boundary", () => {
  it("accepts actual public rows produced by every supplier mapper, including both eSIM views", () => {
    const feeds: Array<[ExplorerItem[], string[]]> = [
      [supplierItemsForCountry(supplier, "ng"), ["numbers", "email"]],
      [bitcallOtpItemsForCountry([{ supplier: "bitcall", ref: "private-otp", country: "ng", app: "WhatsApp", costNgn: 250, stock: 3 }], "ng", "Nigeria"), ["verification"]],
      [boostItems(boosting), ["social"]],
      [esimItemsForCountry([esim], "ng"), ["esim"]],
      [esimItemsForAllDestinations([esim]), ["esim"]],
    ];
    for (const [items, categories] of feeds) {
      expect(items.length).toBeGreaterThan(0);
      expect(parsed(items, categories)).toEqual({ items, incomplete: false });
    }
    expect(feeds.slice(1).every(([items]) => items[0].action !== null)).toBe(true);
  });

  it("locks mismatched checkouts, missing prices, depleted stock and paused orders", () => {
    const id = "otp-000000000000000000000001";
    const original: ExplorerItem = { id, category: "verification", name: "App", description: "App offer", tag: "Other",
      artwork: { kind: "service", name: "numbers" }, source: "live", coverage: "catalog-country", stock: 3,
      myUnits: null, price: 1000, action: { label: "Choose service", href: `/dashboard/services/otp/${id}?country=ng` } };
    const variants: ExplorerItem[] = [
      { ...original, action: { label: "Choose service", href: `/dashboard/services/otp/${id}?country=us` } },
      { ...original, action: { label: "Choose service", href: "/dashboard/services/boost/other" } },
      { ...original, price: null },
      { ...original, price: 0 },
      { ...original, stock: 0 },
      { ...original, orderingPaused: true },
    ];
    for (const item of variants) {
      expect(parsed([item], ["verification"])).toMatchObject({ incomplete: true, items: [{ name: "App", action: null }] });
    }
    const social = boostItems(boosting)[0];
    const wrongBoost = { ...social, action: { label: "Buy boost", href: "/dashboard/services/boost/different-offer" } };
    expect(parsed([wrongBoost], ["social"])).toMatchObject({ incomplete: true, items: [{ action: null }] });
    const wrongEsim = { ...esimItemsForCountry([esim], "ng")[0], action: { label: "Buy eSIM", href: "/dashboard/esim/different-offer" } };
    expect(parsed([wrongEsim], ["esim"])).toMatchObject({ incomplete: true, items: [{ action: null }] });
  });
});
