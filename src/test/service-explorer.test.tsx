import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { findPlan, plans } from "@/lib/catalog";
import { ServiceExplorer } from "@/components/dashboard/ServiceExplorer";
import { UnitsStatus } from "@/components/dashboard/UnitsStatus";
import { formatUnitCount, safeUnitCount } from "@/lib/service-units";
import { EXPLORER_COUNTRIES } from "@/lib/explorer-countries";
import {
  buildServiceExplorer, canPreviewPlan, EXPLORER_CATEGORIES, explorerCategory, explorerCountry,
  filterExplorerItems, planMatchesCountry,
} from "@/lib/service-explorer";

describe("country-first service explorer", () => {
  it("does not construct or show services before a valid country is chosen", () => {
    expect(buildServiceExplorer(null)).toEqual([]);
    expect(buildServiceExplorer("")).toEqual([]);
    expect(buildServiceExplorer("not-a-country")).toEqual([]);
    const markup = renderToStaticMarkup(<ServiceExplorer initialCountry={null} initialCategory={null} />);
    expect(markup).toContain("Choose a country to explore");
    expect(markup).not.toContain("WhatsApp");
    expect(markup).not.toContain("Social promotion");
  });

  it("offers the ISO country and territory directory without treating it as supplier coverage", () => {
    expect(EXPLORER_COUNTRIES.length).toBe(249);
    expect(new Set(EXPLORER_COUNTRIES.map((country) => country.code)).size).toBe(249);
    expect(explorerCountry("bj")?.name).toBe("Benin");
    expect(explorerCountry("ng")?.dial).toBe("+234");
    expect(explorerCountry("bj")?.dial).toBeUndefined();
    expect(EXPLORER_COUNTRIES.filter((country) => !existsSync(`public/images/flags/${country.code}.svg`))).toEqual([]);
    const examples = buildServiceExplorer("bj").filter((item) => item.source === "example");
    expect(examples.length).toBeGreaterThan(0);
    expect(examples.every((item) => item.coverage === "unconfirmed")).toBe(true);
  });

  it("validates country and category parameters rather than guessing", () => {
    expect(explorerCountry("NG")?.name).toBe("Nigeria");
    expect(explorerCountry("Nigeria")).toBeNull();
    expect(explorerCountry(["ng"])).toBeNull();
    expect(explorerCategory("social")).toBe("social");
    expect(explorerCategory("unexpected")).toBe("all");
  });

  it("includes every product family and explicitly separates social promotion from app verification", () => {
    const ids = EXPLORER_CATEGORIES.map((category) => category.id);
    expect(ids).toEqual(["verification", "social", "numbers", "esim", "proxies", "email", "accounts", "subscriptions", "data", "gift-cards", "tools"]);
    const items = buildServiceExplorer("ng");
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    for (const category of ids) expect(items.some((item) => item.category === category), category).toBe(true);
    expect(items.find((item) => item.id === "verification-instagram")?.description).toBe("SMS verification");
    expect(items.find((item) => item.id === "social-instagram-followers")?.description).toBe("Social promotion");
    for (const brand of ["whatsapp", "instagram", "facebook", "tiktok", "telegram", "google", "youtube", "paypal", "uber"]) {
      expect(items.some((item) => item.id === `verification-${brand}`), brand).toBe(true);
    }
  });

  it("never converts example services into fabricated prices, stock, credits, coverage or checkout", () => {
    for (const country of ["ng", "us", "gb", "jp"]) {
      const examples = buildServiceExplorer(country).filter((item) => item.source === "example");
      expect(examples.length).toBeGreaterThan(40);
      for (const item of examples) {
        expect(item).toMatchObject({ coverage: "unconfirmed", stock: null, myUnits: null, price: null, action: null });
      }
    }
  });

  it("filters exact-region plans correctly and does not treat vague regional labels as country coverage", () => {
    const nigeria = buildServiceExplorer("ng");
    const us = buildServiceExplorer("us");
    expect(nigeria.some((item) => item.id === "plan-vn-ng")).toBe(true);
    expect(nigeria.some((item) => item.id === "plan-vn-us")).toBe(false);
    expect(us.some((item) => item.id === "plan-vn-us")).toBe(true);
    expect(us.some((item) => item.id === "plan-vn-ng")).toBe(false);
    const regional = us.find((item) => item.id === "plan-esim-europe");
    expect(regional).toMatchObject({ coverage: "unconfirmed", action: null });
    expect(nigeria.find((item) => item.id === "plan-email-24")?.coverage).toBe("not-country-specific");
    expect(us.find((item) => item.id === "plan-email-24")?.coverage).toBe("not-country-specific");
  });

  it("does not allow mismatched or multi-unit bundles into the single-unit preview checkout", () => {
    const ng = findPlan("vn-ng")!;
    expect(canPreviewPlan(ng, "ng")).toBe(true);
    expect(canPreviewPlan(ng, "us")).toBe(false);
    expect(canPreviewPlan(findPlan("vn-otp-5")!, "ng")).toBe(false);
    expect(canPreviewPlan(findPlan("email-bundle")!, "ng")).toBe(false);
    expect(canPreviewPlan(findPlan("email-team")!, "ng")).toBe(false);
    expect(planMatchesCountry(findPlan("esim-europe")!, "de")).toBe(false);
    for (const item of buildServiceExplorer("ng")) {
      if (!item.id.startsWith("plan-") || !item.action) continue;
      const plan = plans.find((candidate) => `plan-${candidate.slug}` === item.id)!;
      expect(canPreviewPlan(plan, "ng")).toBe(true);
      expect(item.action.href).toContain("country=ng");
    }
  });

  it("shows Nigerian data only for Nigeria and preserves the selected plan in the link", () => {
    const ngData = buildServiceExplorer("ng").filter((item) => item.category === "data");
    expect(ngData.length).toBeGreaterThan(0);
    expect(ngData.find((item) => item.id === "data-airtel-1gb")?.action?.href).toBe("/dashboard/data?plan=airtel-1gb");
    expect(buildServiceExplorer("gb").filter((item) => item.category === "data")).toEqual([]);
  });

  it("filters examples by category, type and search without leaking other categories", () => {
    const items = buildServiceExplorer("ng");
    const followers = filterExplorerItems(items, "social", "instagram", "Followers");
    expect(followers.map((item) => item.id)).toEqual(["social-instagram-followers"]);
    const messaging = filterExplorerItems(items, "verification", "", "Messaging");
    expect(messaging.some((item) => item.name === "WhatsApp")).toBe(true);
    expect(messaging.every((item) => item.category === "verification" && item.tag === "Messaging")).toBe(true);
    expect(filterExplorerItems(items, "social", "no-such-service")).toEqual([]);
  });

  it("renders the selected country's categories and labels unknown quantities", () => {
    const markup = renderToStaticMarkup(<ServiceExplorer initialCountry="ng" initialCategory="social" />);
    expect(markup).toContain("Nigeria selected");
    expect(markup).toContain("Social promotion");
    expect(markup).toContain("Instagram followers");
    expect(markup).toContain("Not connected");
    expect(markup).toContain("Stock");
    expect(markup).toContain("Unknown");
    expect(markup).toContain("My units");
    expect(markup).toContain("Not tracked");
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
    expect(markup).toContain("0 left");
    expect(markup).toContain("23 left");
  });
});
