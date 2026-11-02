import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isProductFamily,
  mappedPlanIds,
  parseMappings,
  planFor,
  resolveMappedProduct,
  mappingMissingRequirements,
  mappedPurchasesEnabled,
} from "@/lib/product-mappings";

/**
 * The mapping file is the only thing standing between a priced catalogue plan
 * and a real supplier charge. Every malformed row must disable the whole file,
 * and the gate must stay shut until a key, a verified mapping and (on a preview
 * database) an explicit mock flag are all present.
 */

const VALID = {
  schema: 1,
  products: [
    { family: "data", planId: "mtn-1gb", productId: "product_data1" },
    { family: "subscriptions", planId: "netflix-1month", productId: "product_sub1" },
    { family: "proxies", planId: "proxy-ng-1", productId: "product_proxy1" },
  ],
};

let temp: string | null = null;

beforeEach(() => {
  // The inline production value must not leak into file-based test cases.
  vi.stubEnv("PRODUCT_MAPPINGS_JSON", "");
});

function useMappingFile(products: unknown[] = VALID.products, schema = 1) {
  temp = mkdtempSync(path.join(tmpdir(), "pryva-mapping-"));
  const file = path.join(temp, "product-mappings.json");
  writeFileSync(file, JSON.stringify({ schema, products }));
  vi.stubEnv("PRODUCT_MAPPINGS_FILE", file);
  return file;
}

afterEach(() => {
  vi.unstubAllEnvs();
  if (temp) {
    rmSync(temp, { recursive: true, force: true });
    temp = null;
  }
});

describe("parseMappings", () => {
  it("accepts the empty shipping file without enabling anything", () => {
    expect(parseMappings(JSON.stringify({ schema: 1, products: [] }))).toEqual({ mappings: [], errors: [] });
  });

  it("accepts one verified row per family", () => {
    const result = parseMappings(JSON.stringify(VALID));
    expect(result.errors).toEqual([]);
    expect(result.mappings).toHaveLength(3);
    expect(result.mappings.map((row) => row.family)).toEqual(["data", "subscriptions", "proxies"]);
  });

  it("refuses a file that is not JSON, has the wrong schema or has no products array", () => {
    expect(parseMappings("{").mappings).toEqual([]);
    expect(parseMappings(JSON.stringify([])).mappings).toEqual([]);
    expect(parseMappings(JSON.stringify({ schema: 2, products: [] })).errors.length).toBeGreaterThan(0);
    expect(parseMappings(JSON.stringify({ schema: 1 })).errors.length).toBeGreaterThan(0);
  });

  it("disables the entire file when any row is bad", () => {
    const cases: unknown[][] = [
      [{ family: "numbers", planId: "vn-ng", productId: "product_x" }],
      [{ family: "data", planId: "mtn-not-a-plan", productId: "product_x" }],
      [{ family: "data", planId: "mtn-1gb", productId: "../api/orders/evil" }],
      [{ family: "data", planId: "mtn-1gb", productId: "has spaces" }],
      [
        { family: "data", planId: "mtn-1gb", productId: "product_a" },
        { family: "data", planId: "mtn-1gb", productId: "product_b" },
      ],
      [{ family: "subscriptions", planId: "proxy-ng-1", productId: "product_x" }],
      [{ family: "proxies", planId: "vn-ng", productId: "product_x" }],
    ];
    for (const products of cases) {
      const result = parseMappings(JSON.stringify({ schema: 1, products }));
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.mappings).toEqual([]);
    }
  });

  it("only recognises the three families that have a route", () => {
    expect(isProductFamily("data")).toBe(true);
    expect(isProductFamily("proxies")).toBe(true);
    expect(isProductFamily("verification")).toBe(false);
    expect(isProductFamily(null)).toBe(false);
  });
});

describe("planFor", () => {
  it("takes the price and order columns from our catalogue, never the supplier", () => {
    const data = planFor("data", "mtn-1gb");
    expect(data).toMatchObject({ service: "data", price: 1000, region: "Nigeria" });
    const subscription = planFor("subscriptions", "netflix-1month");
    expect(subscription?.service).toBe("subscriptions");
    expect(subscription?.price).toBeGreaterThan(0);
    const proxy = planFor("proxies", "proxy-ng-1");
    expect(proxy).toMatchObject({ service: "proxies", productName: "Nigeria Starter" });
  });

  it("refuses a plan from the wrong family", () => {
    expect(planFor("proxies", "mtn-1gb")).toBeNull();
    expect(planFor("data", "proxy-ng-1")).toBeNull();
    expect(planFor("subscriptions", "proxy-ng-1")).toBeNull();
  });
});

describe("mappedPurchasesEnabled", () => {
  it("stays shut on the shipping configuration", () => {
    vi.stubEnv("FOXRELOAD_API_KEY", "");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("PRODUCT_MAPPINGS_FILE", "");
    for (const family of ["data", "subscriptions", "proxies"] as const) {
      expect(mappedPurchasesEnabled(family)).toBe(false);
      expect(mappedPlanIds(family)).toEqual([]);
      expect(resolveMappedProduct(family, "mtn-1gb")).toBeNull();
    }
  });

  it("names the missing key, mapping and mock flag in the diagnostics list", () => {
    vi.stubEnv("FOXRELOAD_API_KEY", "");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("FOXRELOAD_IS_MOCK", "false");
    vi.stubEnv("PRODUCT_MAPPINGS_FILE", "");
    const missing = mappingMissingRequirements("data").join(" ");
    expect(missing).toContain("FOXRELOAD_API_KEY");
    expect(missing).toContain("No verified FoxReload product");
    expect(missing).toContain("FOXRELOAD_IS_MOCK=true");
  });

  it("opens only the family that has a verified mapping, and only with key + mock on preview", () => {
    useMappingFile([
      { family: "data", planId: "mtn-1gb", productId: "product_data1" },
    ]);
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("FOXRELOAD_IS_MOCK", "true");

    vi.stubEnv("FOXRELOAD_API_KEY", "");
    expect(mappedPurchasesEnabled("data")).toBe(false);

    vi.stubEnv("FOXRELOAD_API_KEY", "ak_test_key");
    expect(mappedPurchasesEnabled("data")).toBe(true);
    expect(mappedPurchasesEnabled("proxies")).toBe(false);
    expect(mappedPlanIds("data")).toEqual(["mtn-1gb"]);
    expect(mappingMissingRequirements("data")).toEqual([]);
    expect(resolveMappedProduct("data", "mtn-1gb")).toMatchObject({
      service: "data",
      price: 1000,
      productId: "product_data1",
    });
    expect(resolveMappedProduct("data", "mtn-2gb")).toBeNull();
  });

  it("reads real product IDs from the inline deployment value, never the committed template", () => {
    vi.stubEnv("PRODUCT_MAPPINGS_JSON", JSON.stringify({
      schema: 1,
      products: [{ family: "proxies", planId: "proxy-ng-1", productId: "product_inline1" }],
    }));
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("FOXRELOAD_IS_MOCK", "true");
    vi.stubEnv("FOXRELOAD_API_KEY", "ak_test_key");
    expect(mappedPurchasesEnabled("proxies")).toBe(true);
    expect(mappedPurchasesEnabled("data")).toBe(false);
    expect(resolveMappedProduct("proxies", "proxy-ng-1")?.productId).toBe("product_inline1");
  });

  it("refuses real supplier charges against a fictional preview wallet", () => {
    useMappingFile();
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("FOXRELOAD_API_KEY", "ak_live_key");
    vi.stubEnv("FOXRELOAD_IS_MOCK", "false");
    expect(mappedPurchasesEnabled("data")).toBe(false);
    expect(mappingMissingRequirements("data").join(" ")).toContain("FOXRELOAD_IS_MOCK=true");
  });
});
