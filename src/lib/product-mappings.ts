import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import { findPlan } from "@/lib/catalog";
import { findDataPlan } from "@/lib/airtime";
import { getDigitalPlan } from "@/lib/digital-services";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { isFoxreloadConfigured } from "@/lib/foxreload";

/**
 * The seam between the Pryva catalogue and a real, code-delivering supplier
 * product.
 *
 * Data, subscriptions and proxies were catalogued for months with no supplier
 * behind them: their purchase routes were permanent 503s and every card said
 * "Not connected". FoxReload is already integrated and tested for gift-card
 * vouchers, so it can also deliver those families *if* an operator has verified
 * an actual product in its catalogue. This module is the whole of that decision.
 *
 * Three rules keep it honest:
 *
 *  • **No invented product.** Nothing is sellable until a human writes a real
 *    supplier product ID into `data/product-mappings.json`. We never guess an
 *    ID from a plan name, and we never search the supplier for a "close enough"
 *    match: a wrong match delivers the wrong goods for real money.
 *  • **Fail closed on the whole file.** One malformed or duplicate entry
 *    invalidates every mapping, rather than leaving a partly enabled catalogue
 *    where some plans work and the rest silently 503.
 *  • **One gate, everywhere.** The route, the readiness verdicts, the storefront
 *    buttons and the diagnostics report all ask `mappedPurchasesEnabled()`, so
 *    the UI can never offer something checkout would refuse.
 *
 * Supplier product IDs are deliberately server-only. The owner rule is that no
 * customer learns which supplier delivered an order; browser code receives only
 * our own plan IDs, which are already public in the catalogue.
 */

export const PRODUCT_FAMILIES = ["data", "subscriptions", "proxies"] as const;
export type ProductFamily = (typeof PRODUCT_FAMILIES)[number];

export type ProductMapping = {
  family: ProductFamily;
  /** An id that already exists in the Pryva catalogue. */
  planId: string;
  /** The id FoxReload published for the product. Never a guess. */
  productId: string;
};

export type MappedPlan = ProductMapping & {
  /** Columns for `orders`, derived from our catalogue rather than the supplier. */
  service: "data" | "subscriptions" | "proxies";
  productName: string;
  planLabel: string;
  region: string;
  duration: string;
  /** Naira price the customer pays, from the Pryva catalogue. */
  price: number;
};

export type MappingFileResult = { mappings: ProductMapping[]; errors: string[] };

const DEFAULT_FILE = path.join(process.cwd(), "data", "product-mappings.json");
const MAX_MAPPINGS = 500;
const PRODUCT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;

/**
 * Override exists so staging and tests can point at a separate mapping file.
 * The committed file is only an empty template: the repository is public, so a
 * real product ID must never be committed to it. Deployments set
 * `PRODUCT_MAPPINGS_JSON` (inline JSON, server-side only) or point
 * `PRODUCT_MAPPINGS_FILE` at a file outside the checkout.
 */
export function mappingFilePath(): string {
  return process.env.PRODUCT_MAPPINGS_FILE?.trim() || DEFAULT_FILE;
}

export function isProductFamily(value: unknown): value is ProductFamily {
  return typeof value === "string" && (PRODUCT_FAMILIES as readonly string[]).includes(value);
}

/**
 * Does this id exist in the catalogue for the family it claims? A mapping to a
 * renamed or removed plan would otherwise leave a buy button that always 404s.
 */
export function planFor(family: ProductFamily, planId: string): MappedPlan | null {
  if (family === "data") {
    const plan = findDataPlan(planId);
    return plan
      ? {
          family,
          planId,
          productId: "",
          service: "data",
          productName: plan.name,
          planLabel: `${plan.size} · ${plan.duration}`,
          region: "Nigeria",
          duration: plan.duration,
          price: plan.price,
        }
      : null;
  }
  if (family === "subscriptions") {
    const found = getDigitalPlan(planId);
    return found
      ? {
          family,
          planId,
          productId: "",
          service: "subscriptions",
          productName: `${found.service.name} ${found.plan.name}`,
          planLabel: found.plan.duration,
          region: "Global",
          duration: found.plan.duration,
          price: found.plan.price,
        }
      : null;
  }
  const plan = findPlan(planId);
  return plan && plan.service === "proxies"
    ? {
        family,
        planId,
        productId: "",
        service: "proxies",
        productName: plan.name,
        planLabel: plan.planLabel,
        region: plan.region,
        duration: plan.duration,
        price: plan.price,
      }
    : null;
}

/** Pure so a bad file can be tested without touching the checkout or the disk. */
export function parseMappings(text: string): MappingFileResult {
  const errors: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { mappings: [], errors: ["Mapping file is not valid JSON."] };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { mappings: [], errors: ["Mapping file must be an object."] };
  }
  const file = raw as Record<string, unknown>;
  if (file.schema !== 1) errors.push("Mapping file schema must be 1.");
  if (!Array.isArray(file.products)) {
    return { mappings: [], errors: [...errors, "Mapping file needs a products array."] };
  }
  if (file.products.length > MAX_MAPPINGS) {
    errors.push(`At most ${MAX_MAPPINGS} mappings are allowed.`);
  }

  const mappings: ProductMapping[] = [];
  const seen = new Set<string>();
  file.products.forEach((entry: unknown, index: number) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`products[${index}] must be an object.`);
      return;
    }
    const row = entry as Record<string, unknown>;
    const label = `products[${index}]`;
    if (!isProductFamily(row.family)) {
      errors.push(`${label}.family must be one of ${PRODUCT_FAMILIES.join(", ")}.`);
      return;
    }
    if (typeof row.planId !== "string" || !row.planId.trim() || !planFor(row.family, row.planId)) {
      errors.push(`${label}.planId is not a ${row.family} plan in the Pryva catalogue.`);
      return;
    }
    if (typeof row.productId !== "string" || !PRODUCT_ID.test(row.productId)) {
      errors.push(`${label}.productId must be a plain product id (letters, digits, _ . : -).`);
      return;
    }
    const key = `${row.family}\u0000${row.planId}`;
    if (seen.has(key)) {
      errors.push(`${label} duplicates an earlier mapping for ${row.family}/${row.planId}.`);
      return;
    }
    seen.add(key);
    mappings.push({
      family: row.family,
      planId: row.planId,
      productId: row.productId,
    });
  });

  // One bad row must not leave a half-enabled catalogue. Everything is refused.
  return { mappings: errors.length ? [] : mappings, errors };
}

export function readMappingFile(): MappingFileResult {
  // An inline value wins over the file. Vercel cannot write a file outside the
  // checkout, and the checkout is public — so production keeps real IDs in an
  // environment variable instead of a committed JSON file.
  const inline = process.env.PRODUCT_MAPPINGS_JSON?.trim();
  if (inline) return parseMappings(inline);
  try {
    return parseMappings(readFileSync(mappingFilePath(), "utf8"));
  } catch {
    return { mappings: [], errors: [`Could not read ${path.basename(mappingFilePath())}.`] };
  }
}

export function readMappings(): ProductMapping[] {
  return readMappingFile().mappings;
}

/** The single capability gate. Used by checkout, readiness, storefront and diagnostics. */
export function mappedPurchasesEnabled(family: ProductFamily): boolean {
  if (!isFoxreloadConfigured()) return false;
  // A preview database holds fictional wallet money. Only an explicitly mocked
  // supplier order may be played against it, and never a real supplier charge.
  if (isPreviewDatabase() && process.env.FOXRELOAD_IS_MOCK !== "true") return false;
  return readMappings().some((mapping) => mapping.family === family);
}

/** Exactly what an operator still has to supply before this family can sell. */
export function mappingMissingRequirements(family: ProductFamily): string[] {
  const missing: string[] = [];
  const file = readMappingFile();
  if (!isFoxreloadConfigured()) missing.push("FOXRELOAD_API_KEY is not configured.");
  if (file.errors.length) missing.push(...file.errors);
  if (!file.mappings.some((mapping) => mapping.family === family)) {
    missing.push(`No verified FoxReload product is mapped for ${family} in ${path.basename(mappingFilePath())}.`);
  }
  if (isPreviewDatabase() && process.env.FOXRELOAD_IS_MOCK !== "true") {
    missing.push("Preview database: set FOXRELOAD_IS_MOCK=true for a staging purchase.");
  }
  return missing;
}

/** Our own plan IDs only — safe to hand to a client component. */
export function mappedPlanIds(family: ProductFamily): string[] {
  if (!mappedPurchasesEnabled(family)) return [];
  return readMappings()
    .filter((mapping) => mapping.family === family)
    .map((mapping) => mapping.planId);
}

/** Resolve one buyable plan, or null. Fails closed when the family is off. */
export function resolveMappedProduct(family: ProductFamily, planId: string): MappedPlan | null {
  if (!mappedPurchasesEnabled(family)) return null;
  const mapping = readMappings().find((row) => row.family === family && row.planId === planId);
  if (!mapping) return null;
  const plan = planFor(family, planId);
  return plan ? { ...plan, productId: mapping.productId } : null;
}
