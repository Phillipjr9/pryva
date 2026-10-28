/**
 * Hand-sourced catalog — SERVER ONLY.
 *
 * Some products have no supplier API at all: they are bought by hand from a
 * storefront and the credentials are pasted back in. This module turns
 * `data/manual-catalog.json` into ordinary marketplace listings so they can be
 * sold through the same checkout, priced by the same margin band, and delivered
 * through the same order record — the only difference is that fulfilment goes
 * through the admin queue instead of an API call.
 *
 * Two honesty rules are built in:
 *
 *  • **No invented stock.** These sources publish no live count, so `stock` is
 *    `null` and availability is the owner's explicit `available` flag. The
 *    storefront must say "confirmed after payment", never "12 in stock".
 *  • **No supplier identity.** `source` and `note` are private owner fields and
 *    are deliberately not part of the returned shape.
 */

import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { logger } from "@/lib/logger";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { usdMicros, usdStringFromMicros, SupplierMoneyError } from "@/lib/supplier-money";
import { DEFAULT_WARRANTY_DAYS, warrantyDaysForGroup } from "@/lib/warranty";

const CATALOG_PATH = path.join(process.cwd(), "data", "manual-catalog.json");
const MANUAL_TOKEN = "3";
const DEFAULT_MAX_QUANTITY = 5;
const HARD_MAX_QUANTITY = 50;

export type ManualProduct = {
  /** Opaque routing token, same shape as an API-sourced listing. */
  slug: string;
  /** Internal id, used by the fulfilment queue. */
  id: string;
  title: string;
  group: string;
  /** Canonical six-decimal USD wholesale cost. */
  costUsd: string;
  warrantyDays: number;
  /** Owner's declaration that this can currently be sourced. */
  available: boolean;
  maxQuantity: number;
};

type RawRow = {
  label?: unknown;
  group?: unknown;
  costUsd?: unknown;
  warrantyDays?: unknown;
  available?: unknown;
  maxQuantity?: unknown;
};

let cached: { value: ManualProduct[]; loadedAt: number } | null = null;
const CACHE_TTL_MS = 60 * 1000;

export function clearManualCatalogCache(): void {
  cached = null;
}

function isValidId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,60}$/.test(id);
}

/** Read and validate the catalog. A bad row is skipped and logged, not thrown. */
export function readManualCatalog(): ManualProduct[] {
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.value;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
  } catch (error) {
    // No manual catalog is a supported configuration, not a crash.
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    logger.warn("Manual catalog could not be read", {
      code: code === "ENOENT" ? "missing" : "unreadable",
    });
    cached = { value: [], loadedAt: Date.now() };
    return cached.value;
  }

  const products = (raw && typeof raw === "object" && !Array.isArray(raw))
    ? (raw as { products?: unknown }).products
    : null;
  const rows: ManualProduct[] = [];

  if (products && typeof products === "object" && !Array.isArray(products)) {
    for (const [id, value] of Object.entries(products as Record<string, RawRow>)) {
      if (!isValidId(id) || !value || typeof value !== "object") {
        logger.warn("Skipping an invalid manual catalog row", { id: id.slice(0, 40) });
        continue;
      }
      const label = typeof value.label === "string" ? value.label.trim().slice(0, 160) : "";
      if (!label) {
        logger.warn("Skipping a manual catalog row with no label", { id });
        continue;
      }
      let costUsd: string;
      try {
        const micros = usdMicros(typeof value.costUsd === "number" ? value.costUsd : String(value.costUsd ?? ""));
        if (micros <= 0) throw new SupplierMoneyError("non-positive cost");
        costUsd = usdStringFromMicros(micros);
      } catch {
        logger.warn("Skipping a manual catalog row with an unusable cost", { id });
        continue;
      }
      const group = typeof value.group === "string" && value.group.trim() ? value.group.trim().slice(0, 40) : "Other";
      const warrantyDays = Number.isSafeInteger(value.warrantyDays) && (value.warrantyDays as number) > 0 &&
        (value.warrantyDays as number) <= 365
        ? (value.warrantyDays as number)
        : warrantyDaysForGroup(group) || DEFAULT_WARRANTY_DAYS;
      const maxQuantity = Number.isSafeInteger(value.maxQuantity) && (value.maxQuantity as number) >= 1
        ? Math.min(value.maxQuantity as number, HARD_MAX_QUANTITY)
        : DEFAULT_MAX_QUANTITY;

      rows.push({
        slug: `p${MANUAL_TOKEN}:${id}`,
        id,
        title: label,
        group,
        costUsd,
        warrantyDays,
        available: value.available === true,
        maxQuantity,
      });
    }
  }

  cached = { value: rows, loadedAt: Date.now() };
  return rows;
}

/**
 * Is the hand-sourced lane open?
 *
 * It is real commerce: a customer pays and the owner owes them an item. In the
 * preview/demo database the wallet is fictional and the marketplace is a
 * simulation, so the lane stays closed there — otherwise demo orders would land
 * in the fulfilment queue looking like promises that still have to be kept.
 */
function manualLaneEnabled(): boolean {
  return !isPreviewDatabase();
}

/** Only products the owner has marked as sourceable are sellable. */
export function availableManualProducts(): ManualProduct[] {
  if (!manualLaneEnabled()) return [];
  return readManualCatalog().filter((product) => product.available);
}

export function isManualSlug(slug: string): boolean {
  return slug.startsWith(`p${MANUAL_TOKEN}:`);
}

export function manualProductId(slug: string): string | null {
  if (!isManualSlug(slug)) return null;
  const id = slug.slice(`p${MANUAL_TOKEN}:`.length);
  return isValidId(id) ? id : null;
}

/** One product by its listing slug, or null. Availability is re-checked. */
export function getManualProduct(slug: string): ManualProduct | null {
  if (!manualLaneEnabled()) return null;
  const id = manualProductId(slug);
  if (!id) return null;
  return readManualCatalog().find((product) => product.id === id && product.available) ?? null;
}

/** How many units a basket may contain for one listing. */
export function manualMaxQuantity(slug: string): number {
  return getManualProduct(slug)?.maxQuantity ?? 1;
}

/**
 * Warranty for a slug, ignoring availability.
 *
 * An order already placed keeps its warranty even after the owner switches the
 * product off, so the fulfilment queue must be able to read it.
 */
export function manualWarrantyDays(slug: string): number | null {
  const id = manualProductId(slug);
  if (!id) return null;
  const product = readManualCatalog().find((row) => row.id === id);
  return product ? product.warrantyDays : null;
}
