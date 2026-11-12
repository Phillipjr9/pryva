export type AccountCategory = { id: number; title: string; slug: string };
export type AccountListing = {
  id: number;
  slug: string;
  title: string;
  stock: number | null;
  sold: number | null;
  category: string | null;
  subcategory: string | null;
  priceNgn: number;
  warrantyDays: number | null;
  minQuantity: number;
  maxQuantity: number;
  /** A manual listing can be available without a published stock count. */
  available: boolean;
  fulfilment: "instant" | "manual";
  /** Server-side checkout gate; absence must be treated as not buyable. */
  purchasable?: boolean;
};
export type AccountMeta = { current_page: number; last_page: number; per_page: number; total: number };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function whole(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}
function count(value: unknown): value is number | null { return value === null || whole(value); }
function textOrNull(value: unknown): value is string | null { return value === null || typeof value === "string"; }

/** Validate the public response without letting one corrupt row crash the page. */
export function readAccountListings(value: unknown): { listings: AccountListing[]; meta: AccountMeta | null; incomplete: boolean } | null {
  if (!record(value) || !Array.isArray(value.listings)) return null;
  const listings: AccountListing[] = [];
  const seenIds = new Set<number>();
  const seenSlugs = new Set<string>();
  let incomplete = value.partial === true || (value.partial !== undefined && typeof value.partial !== "boolean");
  for (const raw of value.listings) {
    if (!record(raw) || !whole(raw.id, 1) || seenIds.has(raw.id) ||
        typeof raw.slug !== "string" || raw.slug.trim() !== raw.slug || !/^p[123]:[^\u0000-\u001f\u007f]{1,76}$/.test(raw.slug) || seenSlugs.has(raw.slug) ||
        typeof raw.title !== "string" || !raw.title.trim() || raw.title.length > 1000 ||
        !whole(raw.priceNgn, 1) || !whole(raw.minQuantity, 1) || !whole(raw.maxQuantity, 1) ||
        raw.minQuantity > raw.maxQuantity || !Number.isSafeInteger(raw.priceNgn * raw.maxQuantity) ||
        (raw.fulfilment !== "instant" && raw.fulfilment !== "manual")) {
      incomplete = true;
      continue;
    }
    seenIds.add(raw.id); seenSlugs.add(raw.slug);
    const validStock = count(raw.stock);
    const validSold = count(raw.sold);
    const validCategory = textOrNull(raw.category);
    const validSubcategory = textOrNull(raw.subcategory);
    const validWarranty = count(raw.warrantyDays);
    const validAvailable = typeof raw.available === "boolean";
    const validPurchasable = raw.purchasable === undefined || typeof raw.purchasable === "boolean";
    if (!validStock || !validSold || !validCategory || !validSubcategory || !validWarranty || !validAvailable || !validPurchasable) incomplete = true;
    listings.push({
      id: raw.id, slug: raw.slug, title: raw.title,
      stock: validStock ? raw.stock as number | null : null,
      sold: validSold ? raw.sold as number | null : null,
      category: validCategory ? raw.category as string | null : null,
      subcategory: validSubcategory ? raw.subcategory as string | null : null,
      priceNgn: raw.priceNgn, warrantyDays: validWarranty ? raw.warrantyDays as number | null : null,
      minQuantity: raw.minQuantity, maxQuantity: raw.maxQuantity,
      available: raw.available === true, fulfilment: raw.fulfilment,
      // Malformed stock or availability can never open checkout.
      purchasable: validStock && validAvailable && validPurchasable && raw.purchasable === true,
    });
  }
  const rawMeta = value.meta;
  let meta: AccountMeta | null = null;
  if (record(rawMeta) && whole(rawMeta.current_page, 1) && whole(rawMeta.last_page, 1) &&
      whole(rawMeta.per_page, 1) && whole(rawMeta.total)) {
    meta = { current_page: rawMeta.current_page, last_page: rawMeta.last_page, per_page: rawMeta.per_page, total: rawMeta.total };
  } else if (rawMeta !== undefined && rawMeta !== null) incomplete = true;
  return { listings, meta, incomplete };
}

/** Categories are also supplier-derived and must be safe to render as text. */
export function readAccountCategories(value: unknown): { categories: AccountCategory[]; subcategories: AccountCategory[]; incomplete: boolean } | null {
  if (!record(value) || !Array.isArray(value.categories) || (value.subcategories !== undefined && !Array.isArray(value.subcategories))) return null;
  let incomplete = value.partial === true || (value.partial !== undefined && typeof value.partial !== "boolean");
  function read(rows: unknown[]): AccountCategory[] {
    const seen = new Set<number>();
    return rows.flatMap((row) => {
      if (!record(row) || !whole(row.id, 1) || seen.has(row.id) || typeof row.title !== "string" || !row.title.trim() || typeof row.slug !== "string") {
        incomplete = true;
        return [];
      }
      seen.add(row.id);
      return [{ id: row.id, title: row.title, slug: row.slug }];
    });
  }
  return { categories: read(value.categories), subcategories: read(Array.isArray(value.subcategories) ? value.subcategories : []), incomplete };
}
