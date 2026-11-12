import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SERVICES, SERVICE_IDS } from "@/lib/services/registry";
import { findPlan, plans } from "@/lib/services/catalog";
import { ServiceCard, ServiceExplorer } from "@/components/dashboard/ServiceExplorer";
import { UnitsStatus } from "@/components/dashboard/UnitsStatus";
import { formatUnitCount, safeUnitCount } from "@/lib/services/service-units";
import { EXPLORER_COUNTRIES } from "@/lib/content/explorer-countries";
import {
  buildServiceExplorer, canPreviewPlan, EXPLORER_CATEGORIES, explorerCategory, explorerCountry,
  filterExplorerItems, interleaveExplorerItems, planMatchesCountry, type ExplorerItem,
} from "@/lib/services/service-explorer";

describe("country-first service explorer", () => {
  it("defaults to a single active country instead of blocking the whole explorer", () => {
    expect(buildServiceExplorer(null)).toEqual([]);
    expect(buildServiceExplorer("")).toEqual([]);
    expect(buildServiceExplorer("not-a-country")).toEqual([]);
    const markup = renderToStaticMarkup(<ServiceExplorer initialCountry={null} initialCategory={null} />);
    expect(markup).toContain("Nigeria selected");
    expect(markup).not.toContain("Choose a country to explore");
    expect(markup).toContain("Choose a category");
    expect(markup).not.toContain("Start with a country.");
  });

  it("groups every category and keeps the picker wrapped and touch-friendly on mobile", () => {
    const markup = renderToStaticMarkup(<ServiceExplorer initialCountry="ng" initialCategory={null} />);
    for (const entry of EXPLORER_CATEGORIES) expect(markup).toContain(entry.label.replaceAll("&", "&amp;"));
    for (const title of ["Phone &amp; connectivity", "Digital products &amp; accounts", "Growth &amp; everyday tools"]) {
      expect(markup).toContain(title);
    }
    expect(markup).toContain("min-[360px]:grid-cols-2");
    expect(markup).toContain("min-h-[88px]");
    expect(markup).not.toContain("overflow-x-auto px-1 pb-1");
  });

  it("offers the ISO country and territory directory without treating it as supplier coverage", () => {
    expect(EXPLORER_COUNTRIES.length).toBe(249);
    expect(new Set(EXPLORER_COUNTRIES.map((country) => country.code)).size).toBe(249);
    expect(explorerCountry("bj")?.name).toBe("Benin");
    expect(explorerCountry("ng")?.dial).toBe("+234");
    expect(explorerCountry("bj")?.dial).toBeUndefined();
    expect(EXPLORER_COUNTRIES.filter((country) => !existsSync(`public/images/flags/${country.code}.svg`))).toEqual([]);
    const items = buildServiceExplorer("bj");
    expect(items.every((item) => ["catalog", "tool", "live"].includes(item.source))).toBe(true);
    expect(items.filter((item) => item.category === "verification")).toEqual([]);
  });

  it("validates country and category parameters rather than guessing", () => {
    expect(explorerCountry("NG")?.name).toBe("Nigeria");
    expect(explorerCountry("Nigeria")).toBeNull();
    expect(explorerCountry(["ng"])).toBeNull();
    expect(explorerCategory("social")).toBe("social");
    expect(explorerCategory("unexpected")).toBe("all");
  });

  it("clearly distinguishes app-specific SMS offers from general number plans", () => {
    expect(SERVICES.find((service) => service.id === "verification")?.description).toMatch(/app-specific.*SMS verification/i);
    expect(SERVICES.find((service) => service.id === "numbers")?.description).toMatch(/general.*not listed for a specific app/i);
    for (const category of ["numbers", "verification"] as const) {
      const markup = renderToStaticMarkup(<ServiceExplorer initialCountry="ng" initialCategory={category} />);
      expect(markup).toContain("Not sure which category?");
      expect(markup).toContain("Browse general number plans");
      expect(markup).toContain("Browse app-specific SMS");
      expect(markup).toContain("listed for a specific app");
    }
  });

  it("keeps service categories without fabricating supplier listings", () => {
    const ids = EXPLORER_CATEGORIES.map((category) => category.id);
    expect(ids).toEqual([...SERVICE_IDS]);
    const items = buildServiceExplorer("ng");
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    for (const category of ["verification", "social", "esim", "subscriptions", "data"]) {
      expect(items.some((item) => item.category === category)).toBe(false);
    }
    expect(items.some((item) => item.category === "proxies" && item.source === "live")).toBe(true);
    // Supplier-backed entries arrive separately; a platform vocabulary is not a listing.
    expect(items.some((item) => item.id.startsWith("verification-") || item.id.startsWith("social-"))).toBe(false);
    expect(ids).toContain("gift-cards");
  });

  it("never inserts synthetic platform records into a country catalog", () => {
    for (const country of ["ng", "us", "gb", "jp"]) {
      expect(buildServiceExplorer(country).every((item) => ["catalog", "tool", "live"].includes(item.source))).toBe(true);
      expect(buildServiceExplorer(country).some((item) => item.id.startsWith("verification-") || item.id.startsWith("social-"))).toBe(false);
    }
  });

  it("filters exact-region plans correctly and does not treat vague regional labels as country coverage", () => {
    const nigeria = buildServiceExplorer("ng");
    const us = buildServiceExplorer("us");
    expect(nigeria.some((item) => item.id === "plan-vn-ng")).toBe(true);
    expect(nigeria.some((item) => item.id === "plan-vn-us")).toBe(false);
    expect(us.some((item) => item.id === "plan-vn-us")).toBe(true);
    expect(us.some((item) => item.id === "plan-vn-ng")).toBe(false);
    expect(us.some((item) => item.id === "plan-proxy-eu-10")).toBe(false);
    expect(us.find((item) => item.id === "residential-proxies")).toMatchObject({
      category: "proxies", source: "live", coverage: "unconfirmed",
      action: { href: "/dashboard/proxies" }, price: null,
    });
    // Email is no longer a set of catalogue plans, so nothing here matches a
    // country -- and nothing needs to. The free inbox is a tool item that shows
    // up in every country with the same shape.
    for (const list of [nigeria, us]) {
      expect(list.some((item) => item.id.startsWith("plan-email-"))).toBe(false);
      expect(list.find((item) => item.id === "temporary-inbox")).toMatchObject({
        category: "email", source: "tool", coverage: "not-country-specific",
        stock: null, price: null,
      });
    }
  });

  it("does not allow mismatched or multi-unit bundles into the single-unit preview checkout", () => {
    const ng = findPlan("vn-ng")!;
    expect(canPreviewPlan(ng, "ng")).toBe(true);
    expect(canPreviewPlan(ng, "us")).toBe(false);
    expect(canPreviewPlan(findPlan("vn-otp-5")!, "ng")).toBe(false);
    // The email bundles are gone from the catalogue, so they cannot be previewed
    // or bought at all -- a stronger guarantee than being excluded here.
    for (const slug of ["email-bundle", "email-team", "email-24", "email-30"]) {
      expect(findPlan(slug), `${slug} should no longer exist`).toBeUndefined();
    }
    expect(planMatchesCountry({ ...ng, region: "Europe (38 countries)" }, "de")).toBe(false);
    for (const item of buildServiceExplorer("ng")) {
      if (!item.id.startsWith("plan-") || !item.action) continue;
      const plan = plans.find((candidate) => `plan-${candidate.slug}` === item.id)!;
      expect(canPreviewPlan(plan, "ng")).toBe(true);
      expect(item.action.href).toContain("country=ng");
    }
  });

  it("does not expose unverified mobile-data plans as offers", () => {
    expect(buildServiceExplorer("ng").filter((item) => item.category === "data")).toEqual([]);
    expect(buildServiceExplorer("gb").filter((item) => item.category === "data")).toEqual([]);
  });

  it("keeps each service family in its own shelf instead of interleaving it across unrelated categories", () => {
    const items: ExplorerItem[] = [
      { id: "social-1", category: "social", name: "Instagram", description: "Boost", tag: "Followers", artwork: { kind: "brand", name: "instagram" }, source: "live", coverage: "not-country-specific", stock: null, myUnits: null, price: 1600, action: null },
      { id: "verification-1", category: "verification", name: "WhatsApp", description: "Live app", tag: "Messaging", artwork: { kind: "brand", name: "whatsapp" }, source: "live", coverage: "catalog-country", stock: 12, myUnits: null, price: null, action: null },
      { id: "social-2", category: "social", name: "TikTok", description: "Boost", tag: "Followers", artwork: { kind: "brand", name: "tiktok" }, source: "live", coverage: "not-country-specific", stock: null, myUnits: null, price: 1400, action: null },
      { id: "numbers-1", category: "numbers", name: "NG number", description: "Number", tag: "Single use", artwork: { kind: "service", name: "numbers" }, source: "catalog", coverage: "catalog-country", stock: null, myUnits: null, price: 600, action: null },
    ];

    expect(interleaveExplorerItems(items).map((item) => item.category)).toEqual([
      "numbers",
      "verification",
      "social",
      "social",
    ]);
  });

  it("filters listings by category, type and search without leaking other categories", () => {
    const items = buildServiceExplorer("ng");
    expect(filterExplorerItems(items, "social", "instagram", "Followers")).toEqual([]);
    expect(filterExplorerItems(items, "verification", "", "Messaging")).toEqual([]);
    const rentals = filterExplorerItems(items, "numbers", "", "Rental");
    expect(rentals.every((item) => item.category === "numbers" && item.tag === "Rental")).toBe(true);
    expect(rentals.some((item) => item.id === "plan-rent-ng-30")).toBe(true);
    const singleUse = filterExplorerItems(items, "numbers", "", "Single use");
    expect(singleUse.every((item) => item.category === "numbers" && item.tag === "Single use")).toBe(true);
    expect(singleUse.some((item) => item.id === "plan-vn-ng")).toBe(true);
    const mtnData = filterExplorerItems(items, "data", "", "MTN");
    expect(mtnData).toEqual([]);
    expect(filterExplorerItems(items, "social", "no-such-service")).toEqual([]);
  });

  it("renders the selected country's categories and labels unknown quantities", () => {
    const markup = renderToStaticMarkup(<ServiceExplorer initialCountry="ng" initialCategory="numbers" />);
    expect(markup).toContain("Nigeria selected");
    expect(markup).toContain("Number plans");
    expect(markup).not.toContain("Instagram followers");
    expect(markup).toContain("Stock");
    expect(markup).toContain("Unknown");
    expect(markup).toContain("My units");
    expect(markup).toContain("Not tracked");
  });

  it("shows view-only Bitcall OTP listings without implying unsupported countries can be ordered", () => {
    const item: ExplorerItem = {
      id: "otp-whatsapp-bj", category: "verification", name: "WhatsApp", description: "Stocks left · purchasing is locked for this country",
      tag: "Messaging", artwork: { kind: "brand", name: "whatsapp" }, source: "live",
      coverage: "catalog-country", stock: 6, myUnits: null, price: null, action: null,
    };
    const markup = renderToStaticMarkup(<ServiceCard item={item} countryName="Benin" />);
    expect(markup).toContain("Stocks left:");
    expect(markup).toContain("6 left");
    expect(markup).toContain("Purchasing locked");
    expect(markup).toContain("Purchasing locked");
  });

  it("shows provider-reported Bitcall OTP stock on mobile, including zero and unknown distinctly", () => {
    const item: ExplorerItem = {
      id: "otp-whatsapp", category: "verification", name: "WhatsApp", description: "One-time verification",
      tag: "Messaging", artwork: { kind: "brand", name: "whatsapp" }, source: "live",
      coverage: "catalog-country", stock: 17, myUnits: null, price: 1400,
      action: { label: "Choose service", href: "/dashboard/services/otp?country=ng" },
    };
    const markup = renderToStaticMarkup(<ServiceCard item={item} countryName="Nigeria" />);
    expect(markup).toContain("Stocks left:");
    expect(markup).toContain("17 left");
    expect(markup).toContain("sm:hidden");

    for (const [stock, expected] of [[0, "0 left"], [null, "Not reported"]] as const) {
      const state = renderToStaticMarkup(<ServiceCard item={{ ...item, stock }} countryName="Nigeria" />);
      expect(state).toContain(expected);
    }
  });
});

describe("unit counts", () => {
  it("distinguishes unknown, malformed, zero and actual available stock", () => {
    for (const value of [null, undefined, "0", "12", -1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(safeUnitCount(value)).toBeNull();
    }
    expect(safeUnitCount(0)).toBe(0);
    expect(safeUnitCount(17)).toBe(17);
    expect(formatUnitCount(null, "Unknown")).toBe("Unknown");
    expect(formatUnitCount(0, "Unknown")).toBe("0 left");
    expect(formatUnitCount(1000, "Unknown")).toBe("1,000 left");
    const markup = renderToStaticMarkup(<UnitsStatus stock={0} owned={23} />);
    expect(markup).toContain("grid-cols-1");
    expect(markup).toContain("sm:grid-cols-2");
    expect(markup).toContain("0 left");
    expect(markup).toContain("23 left");
    expect(markup).toContain("text-[0.8125rem]");
    expect(markup).not.toContain("text-[0.58rem]");
  });
});
