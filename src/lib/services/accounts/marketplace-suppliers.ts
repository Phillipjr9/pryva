/**
 * Account-marketplace sourcing — SERVER ONLY.
 *
 * One neutral seam between the storefront and whoever actually holds the stock.
 * Every route goes through this module, so no route, response, log line or
 * browser bundle ever needs to know a supplier's name.
 *
 * Browsing includes configured API catalogues only. Manual listings are retired.
 * Supplier preference never hides another supplier's account listings.
 *
 * Two rules this module exists to protect:
 *
 *  • **A purchase never switches supplier mid-flight.** Falling back while
 *    browsing is harmless; silently buying a different product than the one the
 *    customer priced and approved is not. If the chosen source cannot fulfil,
 *    the order is refused or held for review.
 *  • **Listing ids are opaque routing tokens.** `p1:300004` says "source 1,
 *    product 300004". The number is not a brand initial and carries no meaning
 *    a shopper could use to identify where stock comes from.
 */

import "server-only";
import {
  BulkaccError,
  createOrder,
  ensureSufficientBalance,
  getOrderAccounts,
  getProduct,
  isAmbiguousOutcome,
  isBulkaccConfigured,
  readBulkaccCatalog,
  productPriceUsd,
  type BulkaccProduct,
} from "@/lib/providers/bulkacc";
import {
  AccsZoneError,
  getListing,
  isAccsZoneConfigured,
  listListings,
  purchaseAccounts,
  type AccsZoneRef,
} from "@/lib/providers/accszone";
import { logger } from "@/lib/platform/logger";
import { CatalogueReadTimeout, withCatalogueReadTimeout } from "@/lib/platform/catalogue-read-timeout";
import { clearLocalSnapshots, readSharedSnapshot, SnapshotUnavailableError } from "@/lib/platform/shared-snapshot";
import { usdMicros, usdString } from "@/lib/payments/supplier-money";
import { warrantyDaysForGroup, type FulfilmentMode } from "@/lib/services/warranty";
import { mentionsTwitterAccount } from "@/lib/services/accounts/platform-shortcuts";

/** Opaque, stable routing tokens. Not initials, not abbreviations. */
const PRIMARY_TOKEN = "1";
const FALLBACK_TOKEN = "2";
/** Hand-sourced items: identical slug shape, so the token reveals nothing. */
const MANUAL_TOKEN = "3";

export type SupplierToken = typeof PRIMARY_TOKEN | typeof FALLBACK_TOKEN | typeof MANUAL_TOKEN;

export type MarketplaceCategory = { id: number; title: string; slug: string };

export type MarketplaceListing = {
  /** Opaque routing token the browser sends back at checkout. */
  slug: string;
  /**
   * The source's own identifier, kept server-side so a purchase does not have
   * to re-read the listing to find it. Never part of an API response.
   */
  sourceId: string;
  title: string;
  /** Pryva-facing group label. Never a supplier's own taxonomy. */
  group: string | null;
  /** Browse-only grouping; does not alter the checkout group or warranty. */
  browseGroup?: string | null;
  category: string | null;
  subcategory: string | null;
  /** Canonical six-decimal USD wholesale price. Server-side only. */
  priceUsd: string;
  /** Units available. `null` means unknown — never rendered as zero. */
  stock: number | null;
  minQuantity: number;
  /** Largest basket the source can actually fulfil for this listing. */
  maxQuantity: number;
  /**
   * Whether this can be ordered right now. Distinct from `stock`, because a
   * hand-sourced item has no published count: its availability is the owner's
   * declaration, and the storefront must not turn that into a stock number.
   */
  available: boolean;
  /** Unknown for sources that do not publish it. Never fabricated. */
  sold: number | null;
  warrantyDays: number;
  fulfilment: FulfilmentMode;
};

export type MarketplaceMeta = {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
};

export type CatalogSource = "primary" | "fallback" | "none";

/** Neutral error so routes never import a supplier-specific class. */
export class MarketplaceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    /** True when money may have moved and the order must be held for review. */
    public readonly ambiguous = false,
  ) {
    super(message);
    this.name = "MarketplaceError";
  }
}

/**
 * Pryva-facing labels for supplier product groups.
 *
 * The keys are the supplier's own taxonomy and stay on the server; only the
 * values are ever sent to a browser.
 */
const GROUP_LABELS: Record<string, string> = {
  Spotify: "Streaming",
  Netflix: "Streaming",
  Disney: "Streaming",
  Soundcloud: "Streaming",
  SoundCloud: "Streaming",
  Google: "Email",
  "Other Emails": "Email",
  Yahoo: "Email",
  "Yahoo Mail": "Email",
  Hotmail: "Email",
  Outlook: "Email",
  Microsoft: "Email",
  "Mail.ru": "Email",
  GMX: "Email",
  YouTube: "Video",
  Facebook: "Social",
  Instagram: "Social",
  Twitter: "Social",
  TikTok: "Social",
  "TikTok Ads": "Social",
  Reddit: "Social",
  Discord: "Social",
  Telegram: "Social",
  WhatsApp: "Social",
  Threads: "Social",
  Snapchat: "Social",
  Linkedin: "Social",
  Pinterest: "Social",
  "Other Social Networks": "Social",
  "ID APPLE": "Apple ID",
  Github: "Developer",
  AI: "AI tools",
  OpenAI: "AI tools",
  ChatGPT: "AI tools",
  Tripadvisor: "Reviews",
  Trustpilot: "Reviews",
  Medium: "Publishing",
  Canva: "Publishing",
  "Web 2.0": "Web profiles",
  Game: "Gaming",
  Steam: "Gaming",
  Twitch: "Gaming",
  Kick: "Gaming",
};

/**
 * Every Pryva-facing group label this layer can emit.
 *
 * Exported so the warranty table can be checked against it: `groupLabelFor`
 * returns one of these or "Other", and a label with no warranty row would
 * silently fall back to the 30-day default. Adding a group here should force a
 * deliberate decision about the replacement window it promises, not a quiet
 * inheritance of the fallback.
 */
export const GROUP_LABEL_VALUES: readonly string[] = Object.freeze(
  [...new Set([...Object.values(GROUP_LABELS), "Streaming", "Other"])].sort(),
);

/** Title keywords that mean "streaming" whatever group the source used. */
const STREAMING_KEYWORDS = [
  "netflix", "spotify", "disney", "hulu", "paramount", "prime video",
  "apple tv", "youtube premium", "iptv", "deezer", "tidal", "crunchyroll",
  "soundcloud", "hbo", "peacock", "dazn",
];

/** Title keywords that mean "AI tools" whatever group the source used. */
const AI_KEYWORDS = ["chatgpt", "openai", "midjourney", "claude", "grok"];
const REVIEW_KEYWORDS = ["tripadvisor", "trustpilot", "google review"];
const GAMING_KEYWORDS = ["roblox", "fortnite", "minecraft"];

/**
 * Pryva-facing group for one supplier product.
 *
 * Streaming is checked before the generic group map, because a source may file a
 * Netflix or Disney+ item under a catch-all bucket like "Other Social Networks".
 * The product name is the more specific signal, and streaming is a category the
 * storefront sells on its own — so it must not be swallowed by a coarse bucket.
 */
export function groupLabelFor(product: { groupName?: string | null; name?: string | null }): string {
  const fromGroup = product.groupName ? GROUP_LABELS[product.groupName.trim()] : undefined;
  if (fromGroup === "Streaming") return "Streaming";
  const haystack = ` ${product.groupName ?? ""} ${product.name ?? ""} `.toLowerCase();
  if (STREAMING_KEYWORDS.some((needle) => haystack.includes(needle))) return "Streaming";
  if (fromGroup) return fromGroup;
  if (AI_KEYWORDS.some((needle) => haystack.includes(needle))) return "AI tools";
  if (REVIEW_KEYWORDS.some((needle) => haystack.includes(needle))) return "Reviews";
  if (GAMING_KEYWORDS.some((needle) => haystack.includes(needle))) return "Gaming";
  return "Other";
}

/** Browse known social platforms even when the feed labels the group "Other".
 * The original group still determines order records and warranty. Never
 * override an explicit non-social group, such as email or streaming. */
function browseGroupFor(listing: MarketplaceListing): string | null {
  if (listing.group !== "Other") return listing.group;
  const text = `${listing.title} ${listing.category ?? ""} ${listing.subcategory ?? ""}`;
  return /\b(?:facebook|instagram|tiktok|twitter|reddit|discord|telegram|whatsapp|threads|snapchat|linkedin|pinterest)\b/i.test(text)
    ? "Social" : listing.group;
}

/**
 * Deterministic positive id for a label.
 *
 * FNV-1a over the text only, so an id stays valid across catalog refreshes
 * instead of shifting when the supplier adds a product.
 */
export function labelId(label: string): number {
  let hash = 2166136261;
  for (let index = 0; index < label.length; index += 1) {
    hash ^= label.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2_000_000_000 + 1;
}

function slugFor(token: SupplierToken, reference: string): string {
  return `p${token}:${reference}`;
}

/**
 * Split an opaque listing id back into its source token and product reference.
 *
 * The reference is capped so a full slug still fits `orders.product_slug`
 * (varchar 80) without truncation — a truncated reference could not be
 * re-verified against the source at checkout.
 */
export function parseListingSlug(slug: string): { token: SupplierToken; reference: string } | null {
  const match = /^p([123]):(.{1,76})$/.exec(slug.trim());
  if (!match) return null;
  return { token: match[1] as SupplierToken, reference: match[2] };
}

/** Basket ceiling for an API-sourced listing: bounded by real stock, never above 50. */
function apiMaxQuantity(stock: number | null, minQuantity: number): number {
  const ceiling = stock === null ? 50 : Math.min(50, stock);
  return Math.max(minQuantity, ceiling);
}

export function marketplaceSource(): CatalogSource {
  if (isBulkaccConfigured()) return "primary";
  if (isAccsZoneConfigured()) return "fallback";
  return "none";
}

/** Only a configured API source can supply new account listings. */
export function isMarketplaceCatalogAvailable(): boolean {
  return marketplaceSource() !== "none";
}

function toListing(product: BulkaccProduct): MarketplaceListing {
  const group = groupLabelFor(product);
  return {
    slug: slugFor(PRIMARY_TOKEN, product.code),
    sourceId: product.code,
    title: product.name,
    group,
    category: product.categoryName,
    subcategory: product.groupName,
    priceUsd: productPriceUsd(product),
    stock: product.inStock,
    minQuantity: product.min,
    maxQuantity: apiMaxQuantity(product.inStock, product.min),
    available: product.inStock === null || product.inStock >= product.min,
    sold: null,
    warrantyDays: warrantyDaysForGroup(group),
    fulfilment: "instant",
  };
}

function fromAccsZone(listing: {
  id: number;
  slug: string;
  title: string;
  price: string;
  available_stock: number;
  sold: number;
  category: AccsZoneRef | null;
  subcategory: AccsZoneRef | null;
}): MarketplaceListing {
  const group = groupLabelFor({ groupName: listing.category?.title, name: listing.title });
  let priceUsd: string;
  try {
    priceUsd = usdString(listing.price);
  } catch {
    priceUsd = "0.000000";
  }
  return {
    slug: slugFor(FALLBACK_TOKEN, listing.slug),
    sourceId: Number.isSafeInteger(listing.id) && listing.id > 0 ? String(listing.id) : "",
    title: listing.title,
    group,
    category: listing.category?.title ?? null,
    subcategory: listing.subcategory?.title ?? null,
    priceUsd,
    stock: Number.isSafeInteger(listing.available_stock) && listing.available_stock >= 0
      ? listing.available_stock
      : null,
    minQuantity: 1,
    maxQuantity: apiMaxQuantity(
      Number.isSafeInteger(listing.available_stock) && listing.available_stock >= 0 ? listing.available_stock : null,
      1,
    ),
    available: !Number.isSafeInteger(listing.available_stock) || listing.available_stock >= 1,
    sold: Number.isSafeInteger(listing.sold) && listing.sold >= 0 ? listing.sold : null,
    warrantyDays: warrantyDaysForGroup(group),
    fulfilment: "instant",
  };
}

/** Whole primary catalog, or null when the primary cannot serve it. */
async function primaryListings(): Promise<{ listings: MarketplaceListing[]; partial: boolean; stale: boolean; checkedAt: string } | null> {
  if (!isBulkaccConfigured()) return null;
  try {
    const snapshot = await readBulkaccCatalog();
    const listings = snapshot.products.map((product) => {
      const listing = toListing(product);
      return { ...listing, browseGroup: browseGroupFor(listing) };
    });
    return { listings, partial: snapshot.partial, stale: snapshot.stale === true, checkedAt: snapshot.checkedAt };
  } catch (error) {
    // A primary catalog failure is exactly when the fallback earns its place.
    logger.warn("Primary account catalog unavailable, falling back", {
      code: error instanceof BulkaccError ? error.code : "unknown_error",
    });
    return null;
  }
}

export type ListingQuery = {
  categoryId?: number;
  subcategoryId?: number;
  search?: string;
  inStockOnly?: boolean;
  sort?: "sort_key" | "total_price" | "available_stock" | "title";
  direction?: "asc" | "desc";
  page?: number;
  perPage?: number;
  /** Server-only selling-price resolver, used before global pagination. */
  sellingPrice?: (listing: MarketplaceListing) => Promise<number>;
};

type BrowseCatalog = {
  listings: MarketplaceListing[];
  source: CatalogSource;
  partial: boolean;
  checkedAt: string;
  /** Complete but older than the refresh interval. Never a partial crawl. */
  stale?: boolean;
};
const BROWSE_TTL_MS = 5 * 60 * 1000;
// A separate, short-lived candidate can report an incomplete source without
// ever replacing the last complete combined snapshot. Its shared lease also
// prevents every shopper starting a new crawl during an outage.
const CANDIDATE_TTL_MS = 30_000;
// A source that stops responding must not indefinitely hide the healthy one.
// This is a read-only deadline; the underlying shared work is not cancelled.
const BROWSE_SOURCE_TIMEOUT_MS = 35_000;
const MAX_SECONDARY_PAGES = 100;

export function clearMarketplaceCatalogCache(): void {
  clearLocalSnapshots();
}

async function secondaryListings(): Promise<{ listings: MarketplaceListing[]; checkedAt: string | null }> {
  if (!isAccsZoneConfigured()) return { listings: [], checkedAt: null };
  const checkedAt = new Date().toISOString();
  const deadline = Date.now() + 30_000;
  const listings: MarketplaceListing[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_SECONDARY_PAGES; page++) {
    if (Date.now() >= deadline) throw new Error("Catalogue refresh deadline reached");
    const result = await listListings({ page });
    if (!Array.isArray(result.listings) || !Number.isSafeInteger(result.meta.last_page) ||
        result.meta.last_page < page || result.meta.last_page > MAX_SECONDARY_PAGES ||
        result.meta.current_page !== page) {
      throw new Error("Invalid catalogue page");
    }
    let added = 0;
    for (const row of result.listings) {
      const listing = fromAccsZone(row);
      if (seen.has(listing.slug)) continue;
      seen.add(listing.slug);
      listings.push({ ...listing, browseGroup: browseGroupFor(listing) });
      added++;
    }
    if (page >= result.meta.last_page) {
      if (listings.length < result.meta.total) throw new Error("Incomplete catalogue");
      return { listings, checkedAt };
    }
    if (!added) throw new Error("Catalogue pagination stalled");
  }
  throw new Error("Catalogue exceeds the pagination safety bound");
}

type BrowseConfiguration = { primary: boolean; secondary: boolean };
type Candidate = { catalog: BrowseCatalog | null };

/** A candidate contains only complete per-source walks, even when one is down. */
async function buildCandidateCatalog(config: BrowseConfiguration): Promise<BrowseCatalog | null> {
  const [primaryResult, secondaryResult] = await Promise.allSettled([
    config.primary ? withCatalogueReadTimeout(primaryListings, BROWSE_SOURCE_TIMEOUT_MS) : Promise.resolve(null),
    config.secondary ? withCatalogueReadTimeout(secondaryListings, BROWSE_SOURCE_TIMEOUT_MS) : Promise.resolve(null),
  ]);
  const primary = primaryResult.status === "fulfilled" ? primaryResult.value : null;
  const secondary = secondaryResult.status === "fulfilled" ? secondaryResult.value : null;
  // Never publish an incomplete pagination walk. A complete but older local
  // fallback may be browsed, but its original time and stale marker must survive.
  const usablePrimary = primary && primary.partial === false && typeof primary.checkedAt === "string" && Number.isFinite(Date.parse(primary.checkedAt)) ? primary : null;
  const usableSecondary = secondary && typeof secondary.checkedAt === "string" && Number.isFinite(Date.parse(secondary.checkedAt)) ? secondary : null;
  if (config.primary && !usablePrimary) logger.warn("Account catalogue source unavailable", {
    source: "primary", reason: primaryResult.status === "rejected" && primaryResult.reason instanceof CatalogueReadTimeout
      ? "timeout" : primary?.partial ? "incomplete" : "unavailable",
  });
  if (config.secondary && !usableSecondary) logger.warn("Account catalogue source unavailable", {
    source: "secondary", reason: secondaryResult.status === "rejected" && secondaryResult.reason instanceof CatalogueReadTimeout ? "timeout" : "unavailable",
  });
  if ((config.primary || config.secondary) && !usablePrimary && !usableSecondary) return null;

  const partial = (config.primary && !usablePrimary) || (config.secondary && !usableSecondary);
  return {
    listings: [...(usablePrimary?.listings ?? []), ...(usableSecondary?.listings ?? [])],
    checkedAt: [usablePrimary?.checkedAt, usableSecondary?.checkedAt]
      .filter((date): date is string => !!date).sort()[0] ?? new Date().toISOString(),
    source: usablePrimary ? "primary" : usableSecondary?.listings.length ? "fallback" : "none",
    partial: !!partial,
    stale: usablePrimary?.stale === true,
  };
}

function validBrowseCatalog(value: BrowseCatalog | null | undefined): value is BrowseCatalog {
  return !!value && Array.isArray(value.listings) && value.listings.every((listing) => listing && typeof listing.slug === "string") &&
    typeof value.partial === "boolean" && typeof value.checkedAt === "string" && Number.isFinite(Date.parse(value.checkedAt));
}

/**
 * A separately leased, explicitly partial candidate avoids a source outage
 * hiding another healthy feed on a cold start. An unavailable sentinel is
 * cached briefly too, so repeated requests do not stampede either provider.
 */
async function candidateCatalog(config: BrowseConfiguration): Promise<BrowseCatalog> {
  const snapshot = await readSharedSnapshot<Candidate>({
    key: `accounts:candidate:v1:${config.primary}:${config.secondary}`,
    ttlMs: CANDIDATE_TTL_MS,
    refresh: async () => {
      const catalog = await buildCandidateCatalog(config);
      return { value: { catalog }, checkedAt: catalog?.checkedAt ?? new Date().toISOString() };
    },
  });
  const catalog = snapshot.value?.catalog;
  if (!validBrowseCatalog(catalog)) throw new SnapshotUnavailableError();
  return { ...catalog, stale: snapshot.stale || catalog.stale === true };
}

/**
 * The complete PostgreSQL snapshot remains authoritative and is never replaced
 * by an incomplete or stale candidate. If no complete snapshot exists, return
 * the separate candidate with an explicit partial/stale marker instead of
 * hiding a healthy source. Checkout independently rechecks price and stock.
 */
async function combinedCatalog(): Promise<BrowseCatalog> {
  const config = { primary: isBulkaccConfigured(), secondary: isAccsZoneConfigured() };
  try {
    const snapshot = await readSharedSnapshot<BrowseCatalog>({
      key: `accounts:v2:${config.primary}:${config.secondary}`,
      ttlMs: BROWSE_TTL_MS,
      // A different instance may hold an empty full-catalogue lease while a
      // usable partial candidate already exists. Do not wait 30 seconds for a
      // full publication that cannot happen until the missing source recovers.
      skipColdWait: true,
      refresh: async () => {
        const value = await candidateCatalog(config);
        if (value.partial || value.stale) throw new Error("Account catalogue refresh incomplete");
        return { value, checkedAt: value.checkedAt };
      },
    });
    if (!validBrowseCatalog(snapshot.value) || snapshot.value.partial) throw new SnapshotUnavailableError("The stored catalogue is invalid");
    return { ...snapshot.value, stale: snapshot.stale || snapshot.value.stale === true };
  } catch (error) {
    if (!(error instanceof SnapshotUnavailableError)) throw error;
    return candidateCatalog(config);
  }
}

function categoryEntries(listings: MarketplaceListing[], field: "group" | "category") {
  const labels = new Set(listings.map((listing) => field === "group" ? listing.browseGroup ?? listing.group : listing.category).filter((label): label is string => !!label));
  return [...labels].sort((a, b) => a.localeCompare(b)).map((title) => ({ id: labelId(title), title, slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-") }));
}

export async function listMarketplaceCategories(): Promise<{
  categories: MarketplaceCategory[]; subcategories: MarketplaceCategory[]; source: CatalogSource; partial?: boolean;
}> {
  const catalog = await combinedCatalog();
  return { categories: categoryEntries(catalog.listings, "group"), subcategories: categoryEntries(catalog.listings, "category"), source: catalog.source, partial: catalog.partial };
}

export async function listMarketplaceSubcategories(categoryId: number): Promise<MarketplaceCategory[]> {
  const catalog = await combinedCatalog();
  return categoryEntries(catalog.listings.filter((listing) => labelId(listing.browseGroup ?? listing.group ?? "") === categoryId), "category");
}

function matchesSearch(listing: MarketplaceListing, search: string): boolean {
  const haystack = ` ${listing.title} ${listing.group ?? ""} ${listing.category ?? ""} `.toLowerCase();
  // The shortcut searches the whole catalogue, including products titled X
  // rather than Twitter. Do not broaden this to Xbox, Netflix, or other Xs.
  if (search.trim().toLowerCase() === "twitter") return mentionsTwitterAccount(haystack);
  return search.toLowerCase().split(/\s+/).every((term) => haystack.includes(term));
}

function sortListings(listings: MarketplaceListing[], sort: string, direction: "asc" | "desc"): MarketplaceListing[] {
  const factor = direction === "desc" ? -1 : 1;
  const byLabel = (value: string | null) => value ?? "";
  return [...listings].sort((a, b) => {
    let delta = 0;
    if (sort === "total_price") delta = usdMicros(a.priceUsd) - usdMicros(b.priceUsd);
    else if (sort === "available_stock") delta = (a.stock ?? -1) - (b.stock ?? -1);
    else if (sort === "title") delta = byLabel(a.title).localeCompare(byLabel(b.title));
    else delta = byLabel(a.group).localeCompare(byLabel(b.group)) || byLabel(a.title).localeCompare(byLabel(b.title));
    // Orderable items always outrank ones that cannot be bought, whatever the
    // sort asks for. Ranked on `available`, not on stock: a hand-prepared item
    // has no published count, and ranking it on stock would bury it below
    // sold-out listings it can actually fulfil.
    const aAvailable = a.available ? 0 : 1;
    const bAvailable = b.available ? 0 : 1;
    return (sort === "total_price" ? 0 : aAvailable - bAvailable) || delta * factor || a.slug.localeCompare(b.slug);
  });
}

/**
 * Filter, sort and page a listing set in memory.
 *
 * Category and subcategory ids are resolved against the labels actually present,
 * so a group that only exists in the hand-sourced catalog still filters
 * correctly instead of resolving to nothing.
 */
async function pageInMemory(
  listings: MarketplaceListing[],
  query: ListingQuery,
  page: number,
  perPage: number,
  source: CatalogSource,
): Promise<{ listings: MarketplaceListing[]; meta: MarketplaceMeta; source: CatalogSource }> {
  let filtered = query.inStockOnly
    ? listings.filter((listing) => listing.available && (listing.stock === null
      ? listing.fulfilment === "manual"
      : listing.stock >= listing.minQuantity))
    : listings;

  if (query.categoryId) {
    const labels = new Set(filtered.map((listing) => listing.browseGroup ?? listing.group).filter(Boolean) as string[]);
    const wanted = [...labels].find((label) => labelId(label) === query.categoryId);
    filtered = wanted ? filtered.filter((listing) => (listing.browseGroup ?? listing.group) === wanted) : [];
  }
  if (query.subcategoryId) {
    const names = new Set(filtered.map((listing) => listing.category).filter(Boolean) as string[]);
    const wanted = [...names].find((name) => labelId(name) === query.subcategoryId);
    filtered = wanted ? filtered.filter((listing) => listing.category === wanted) : [];
  }
  if (query.search) {
    filtered = filtered.filter((listing) => matchesSearch(listing, query.search as string));
  }

  const sort = query.sort ?? "total_price";
  let sorted: MarketplaceListing[];
  if (sort === "total_price" && query.sellingPrice) {
    const priced = await Promise.all(filtered.map(async (listing) => ({ listing, price: await query.sellingPrice!(listing) })));
    const direction = query.direction === "desc" ? -1 : 1;
    sorted = priced.sort((a, b) => (a.price - b.price) * direction || a.listing.slug.localeCompare(b.listing.slug)).map(({ listing }) => listing);
  } else sorted = sortListings(filtered, sort, query.direction ?? "asc");
  const total = sorted.length;
  return {
    listings: sorted.slice((page - 1) * perPage, page * perPage),
    meta: { current_page: page, last_page: Math.max(1, Math.ceil(total / perPage)), per_page: perPage, total },
    source,
  };
}

/**
 * Priced-neutral listing page.
 *
 * The primary catalog is filtered in memory: one supplier call serves search,
 * grouping, sorting and pagination instead of one call per page view.
 */
export async function listMarketplaceListings(query: ListingQuery = {}): Promise<{
  listings: MarketplaceListing[]; meta: MarketplaceMeta; source: CatalogSource; partial?: boolean; checkedAt: string; stale?: boolean;
}> {
  const page = Number.isSafeInteger(query.page) && (query.page as number) > 0 ? query.page as number : 1;
  const perPage = Number.isSafeInteger(query.perPage) && (query.perPage as number) > 0 ? Math.min(query.perPage as number, 60) : 24;
  const catalog = await combinedCatalog();
  const result = await pageInMemory(catalog.listings, query, page, perPage, catalog.source);
  return { ...result, partial: catalog.partial, checkedAt: catalog.checkedAt, stale: catalog.stale };
}

/**
 * Authoritative listing for checkout.
 *
 * Always re-read from the source: the cached primary catalog can be up to one minute
 * old, and price and stock are what the customer is charged against.
 */
export async function getMarketplaceListing(slug: string): Promise<MarketplaceListing> {
  const parsed = parseListingSlug(slug);
  if (!parsed) throw new MarketplaceError("Invalid listing", "listing_not_found", 404);

  // Keep legacy tokens parseable for historical orders, but refuse new sales.
  if (parsed.token === MANUAL_TOKEN) {
    throw new MarketplaceError("This listing is no longer available", "listing_not_found", 404);
  }

  if (parsed.token === PRIMARY_TOKEN) {
    try {
      const product = await getProduct(parsed.reference);
      if (product.code !== parsed.reference) {
        throw new MarketplaceError("Invalid listing", "listing_not_found", 404);
      }
      return toListing(product);
    } catch (error) {
      if (error instanceof MarketplaceError) throw error;
      const code = error instanceof BulkaccError ? error.code : "unknown_error";
      throw new MarketplaceError(
        "Could not verify this listing",
        code === "product_not_found" ? "listing_not_found" : code,
        code === "product_not_found" ? 404 : 502,
      );
    }
  }

  try {
    const listing = await getListing(parsed.reference);
    if (!listing || listing.slug !== parsed.reference) {
      throw new MarketplaceError("Invalid listing", "listing_not_found", 404);
    }
    return fromAccsZone(listing);
  } catch (error) {
    if (error instanceof MarketplaceError) throw error;
    const code = error instanceof AccsZoneError ? error.code : "unknown_error";
    throw new MarketplaceError(
      "Could not verify this listing",
      code === "listing_not_found" ? "listing_not_found" : code,
      code === "listing_not_found" ? 404 : 502,
    );
  }
}

/**
 * Promo codes are a feature of the fallback source's API only. The primary
 * source has no promo endpoint, so a code must be refused rather than silently
 * ignored — otherwise a customer who typed one would be charged the full price.
 */
export function supportsPromoCodes(slug: string): boolean {
  return parseListingSlug(slug)?.token === FALLBACK_TOKEN;
}

export type MarketplacePurchase = {
  /** Delivered credential strings. Never log these. */
  accounts: string[];
  /** Supplier-side order reference, for reconciliation. */
  supplierOrder: string | null;
  token: SupplierToken;
};

/**
 * Buy from the source that owns this listing.
 *
 * `clientReference` and `promoCode` are only honoured by the fallback source;
 * the primary API has neither an idempotency key nor a promo endpoint, so the
 * caller's database reservation is the only thing preventing a double purchase.
 * An uncertain outcome is returned as an error with `ambiguous: true` and must
 * be held for review, never retried.
 */
export async function purchaseMarketplaceListing(input: {
  /** Already verified by the caller against the source. Not re-read here: a
   *  second catalog call per purchase wastes rate limit and, worse, could price
   *  the basket on one reading and buy on another. */
  listing: MarketplaceListing;
  quantity: number;
  clientReference: string;
  promoCode?: string;
}): Promise<MarketplacePurchase> {
  const { listing } = input;
  const parsed = parseListingSlug(listing.slug);
  if (!parsed) throw new MarketplaceError("Invalid listing", "listing_not_found", 404);

  // Hand-sourced items have no supplier call to make; the purchase route records
  // the order and the fulfilment queue delivers it. Reaching this function with
  // a manual slug would mean the caller skipped that branch.
  if (parsed.token === MANUAL_TOKEN) {
    throw new MarketplaceError("This item is prepared by hand", "manual_fulfilment", 400);
  }

  if (!Number.isSafeInteger(input.quantity) || input.quantity < listing.minQuantity ||
      input.quantity > Math.max(listing.minQuantity, listing.maxQuantity)) {
    throw new MarketplaceError(
      listing.minQuantity > 1
        ? `This item has a minimum order of ${listing.minQuantity}.`
        : "Invalid quantity",
      "bad_quantity",
      400,
    );
  }
  if (listing.stock !== null && listing.stock < input.quantity) {
    throw new MarketplaceError(`Only ${listing.stock} left in stock.`, "out_of_stock", 409);
  }

  if (parsed.token === PRIMARY_TOKEN) {
    const costMicros = usdMicros(listing.priceUsd) * input.quantity;
    // Refuse before spending the customer's wallet when we already know the
    // supplier balance cannot cover the order.
    if (!(await ensureSufficientBalance(costMicros))) {
      throw new MarketplaceError("Marketplace stock is temporarily unavailable", "insufficient_supplier_balance", 503);
    }
    try {
      const { orderCode } = await createOrder(parsed.reference, input.quantity);
      // Credentials are fetched in a second call; the order code is the handle.
      let accounts: string[] = [];
      try {
        accounts = await getOrderAccounts(orderCode);
      } catch (error) {
        // The order exists and was paid for. Losing the code would strand it, so
        // surface it and let the order be completed by a later retrieval.
        logger.error("Supplier order was created but credentials could not be read", {
          code: error instanceof BulkaccError ? error.code : "unknown_error",
        });
        throw new MarketplaceError("Delivery is being prepared", "credentials_pending", 502, true);
      }
      return { accounts, supplierOrder: orderCode, token: PRIMARY_TOKEN };
    } catch (error) {
      if (error instanceof MarketplaceError) throw error;
      const ambiguous = isAmbiguousOutcome(error);
      throw new MarketplaceError(
        ambiguous ? "Marketplace outcome is unknown" : "Marketplace refused the order",
        error instanceof BulkaccError ? error.code : "unknown_error",
        ambiguous ? 502 : 502,
        ambiguous,
      );
    }
  }

  try {
    const listingId = Number(listing.sourceId);
    if (!Number.isSafeInteger(listingId) || listingId <= 0) {
      throw new MarketplaceError("Could not verify this listing", "listing_not_found", 404);
    }
    const purchase = await purchaseAccounts({
      listingId,
      quantity: input.quantity,
      clientReference: input.clientReference,
      // The discount lands upstream, so the code has to be sent or we pay full
      // price on a basket we already discounted for the customer.
      promoCode: input.promoCode || undefined,
    });
    const accounts = Array.isArray(purchase?.accounts)
      ? purchase.accounts.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      : [];
    const supplierOrder = Number.isSafeInteger(purchase?.order_id) && purchase.order_id > 0
      ? String(purchase.order_id)
      : null;
    return { accounts, supplierOrder, token: FALLBACK_TOKEN };
  } catch (error) {
    const ambiguous = error instanceof AccsZoneError && (error.code === "timeout" || error.code === "network_error");
    throw new MarketplaceError(
      ambiguous ? "Marketplace outcome is unknown" : "Marketplace refused the order",
      error instanceof AccsZoneError ? error.code : "unknown_error",
      502,
      ambiguous,
    );
  }
}
