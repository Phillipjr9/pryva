import "server-only";
import { createHash } from "node:crypto";
import {
  getSmmBalance,
  isSmmPanelConfigured,
  listSmmServices,
  smmPanelApiUrlSetting,
  type SmmService,
} from "@/lib/smm-panel";
import { PROMOTION_EXAMPLES, type ExplorerItem } from "@/lib/service-explorer";
import { normalizeCurrency, retailPerThousand, totalForQuantity } from "@/lib/smm-pricing";

export type BoostSnapshot = {
  services: SmmService[];
  /**
   * The panel's own billing currency, read from its balance response rather than
   * assumed. Null when the panel did not report one. Retail pricing is not
   * derived here: it depends on whether the panel bills NGN or USD, which is a
   * decision that has not been made, so every listing is priced null.
   */
  currency: string | null;
  balance: number | null;
  partial: boolean;
  fetchedAt: string;
};

let cache: { expires: number; snapshot: BoostSnapshot } | null = null;
let inFlight: Promise<BoostSnapshot> | null = null;

/** A short-lived, process-local read cache; the shared rate limit still protects the panel key across instances. */
export async function readBoostSnapshot(refresh = false): Promise<BoostSnapshot> {
  if (!isSmmPanelConfigured()) throw new Error("Boosting supplier not configured");
  if (!refresh && cache && cache.expires > Date.now()) return cache.snapshot;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const [services, balance] = await Promise.allSettled([listSmmServices(), getSmmBalance()]);
    // Without the service list there is nothing to display, so that failure is
    // fatal. Balance only supplies the billing currency, so it degrades instead.
    if (services.status === "rejected") throw new Error("Boosting catalog unavailable");
    const settled = balance.status === "fulfilled" ? balance.value : null;
    const snapshot: BoostSnapshot = {
      services: services.value.slice(0, 2000),
      currency: settled?.currency ?? null,
      balance: settled?.balance ?? null,
      partial: balance.status === "rejected",
      fetchedAt: new Date().toISOString(),
    };
    cache = { snapshot, expires: Date.now() + 30_000 };
    return snapshot;
  })();
  try { return await inFlight; } finally { inFlight = null; }
}

/* ------------------------------------------------------------------ */
/* Customer-facing sanitizing                                           */
/* ------------------------------------------------------------------ */

/**
 * Words that would reveal the sourcing model. Pryva sells these as its own
 * services, so neither the panel's name nor the fact that a panel is involved
 * may reach a customer.
 */
const PROVENANCE_WORDS = ["reseller", "panel", "wholesale", "supplier", "provider", "smm", "api"];

/** Domain tokens of the configured panel, so its brand cannot leak via a name. */
function panelTokens(): string[] {
  const raw = smmPanelApiUrlSetting();
  if (!raw) return [];
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    const generic = new Set(["com", "net", "org", "app", "dev", "io", "co", "uk", "ng", "www", "api", "panel", "smm"]);
    return host.split(".").filter((part) => part.length >= 3 && !generic.has(part));
  } catch {
    return [];
  }
}

function revealsProvenance(text: string): boolean {
  const lowered = text.toLowerCase();
  if (PROVENANCE_WORDS.some((word) => new RegExp(`\\b${word}\\b`).test(lowered))) return true;
  return panelTokens().some((token) => lowered.includes(token));
}

/**
 * Panels decorate names with emoji, newlines and marketing copy. Whitespace is
 * collapsed, pictographs dropped, control characters rejected and the result
 * bounded. Returns null when the text is unusable or would reveal provenance,
 * so the caller can fall back to a synthetic name instead of dropping the
 * listing — coverage must not depend on how a panel formats its catalog.
 */
function readable(value: string | null, max = 70): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[\u{FE00}-\u{FE0F}\u{200D}]/gu, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!collapsed || collapsed.length > max) return null;
  if (revealsProvenance(collapsed)) return null;
  return collapsed;
}

const BOOST_TAGS: Array<{ tag: string; pattern: RegExp }> = [
  { tag: "Subscribers", pattern: /\bsubscribers?\b/i },
  { tag: "Watch time", pattern: /\bwatch\s*time\b|\bwatchtime\b|\bhours\b/i },
  { tag: "Plays", pattern: /\bplays?\b|\bstreams?\b/i },
  { tag: "Views", pattern: /\bviews?\b|\bimpressions?\b/i },
  { tag: "Likes", pattern: /\blikes?\b|\bupvotes?\b/i },
  { tag: "Comments", pattern: /\bcomments?\b/i },
  { tag: "Shares", pattern: /\bshares?\b|\breposts?\b|\bretweets?\b/i },
  { tag: "Saves", pattern: /\bsaves?\b|\bbookmarks?\b/i },
  { tag: "Members", pattern: /\bmembers?\b|\bgroup\s*members?\b/i },
  { tag: "Reactions", pattern: /\breactions?\b|\bemojis?\b/i },
  { tag: "Followers", pattern: /\bfollowers?\b|\bfans\b|\bconnections?\b/i },
];

/** Panel `type` values that describe nothing a customer would understand. */
const UNINFORMATIVE_TYPES = ["default", "package", "standard", "normal", "regular"];

function boostTag(service: SmmService, displayName: string): string {
  const haystack = `${service.name ?? ""} ${service.category ?? ""} ${displayName}`;
  for (const candidate of BOOST_TAGS) {
    if (candidate.pattern.test(haystack)) return candidate.tag;
  }
  // Unmatched services keep their own label if readable.
  const fromCategory = readable(service.category, 24);
  if (fromCategory) return fromCategory;
  const fromType = readable(service.type, 24);
  return fromType && !UNINFORMATIVE_TYPES.includes(fromType.toLowerCase()) ? fromType : "Other";
}

function matchesPlatform(text: string, platform: string): boolean {
  const escaped = platform.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Single-letter platforms such as X need separators, or they match anywhere.
  const pattern = platform.length === 1
    ? new RegExp(`(?:^|[\\s|/,\\-])${escaped}(?:$|[\\s|/,\\-])`, "i")
    : new RegExp(`\\b${escaped}\\b`, "i");
  if (pattern.test(text)) return true;
  if (platform === "X" && /\btwitter\b/i.test(text)) return true;
  return false;
}

/** Panel service identifiers are hashed; the raw id never reaches the browser. */
function itemId(providerId: string): string {
  return `live-boost-${createHash("sha256").update(`boost\0${providerId}`).digest("hex").slice(0, 20)}`;
}

/**
 * A boosting listing as the rest of the app needs it: what to call it, what one
 * thousand units cost at retail, and the bounds the supplier will accept.
 *
 * `perThousand` is retail — the wholesale rate never leaves the server. When it
 * is null (no rate, unknown currency, or a USD panel with no configured
 * conversion) the listing stays read-only: an unpriced service must not offer a
 * Buy button that cannot charge the right amount.
 */
export type BoostListing = {
  id: string;
  serviceId: string;
  name: string;
  tag: string;
  platform: string | null;
  artwork: ExplorerItem["artwork"];
  perThousand: number | null;
  min: number | null;
  max: number | null;
  currency: string | null;
};

export function describeBoost(service: SmmService, snapshotCurrency: string | null): BoostListing {
  const platform = PROMOTION_EXAMPLES.find((candidate) =>
    matchesPlatform(`${service.name ?? ""} ${service.category ?? ""}`, candidate.name));
  const cleanName = readable(service.name);
  const tag = boostTag(service, cleanName ?? "");
  // A category is a grouping label, not a product name: "Instagram" on its own
  // does not tell a customer what they would be buying. So when the panel's own
  // name is unusable or would reveal provenance, synthesize one from the
  // platform and the derived type. Coverage never depends on how a panel words
  // its catalog.
  const name = cleanName ?? `${platform?.name ?? "Social"} ${tag.toLowerCase()}`;
  const currency = normalizeCurrency(service.currency) ? service.currency : snapshotCurrency;

  return {
    id: itemId(service.id),
    serviceId: service.id,
    name,
    tag,
    platform: platform?.name ?? null,
    artwork: platform ? { kind: "brand", name: platform.brand } : { kind: "service", name: "bulk" },
    perThousand: retailPerThousand({ wholesaleRatePerThousand: service.ratePer1000, currency }),
    min: service.min,
    max: service.max,
    currency: normalizeCurrency(currency),
  };
}

/** The intents a customer can filter by, and the ones listed in the shop. */
export const LISTED_TAGS = new Set([
  "Followers",
  "Likes",
  "Views",
  "Subscribers",
  "Comments",
  "Shares",
  "Saves",
  "Members",
  "Plays",
  "Watch time",
  "Reactions",
]);

export type BoostSelection = {
  /** One service per platform and intent, ready to sell. */
  services: SmmService[];
  /** How many the panel returned. */
  considered: number;
  /** How many of those survived selection. */
  listed: number;
};

/**
 * Reduce a real panel's catalogue to the shop.
 *
 * A production panel is not seven services — JustAnotherPanel alone returns
 * thousands, most of them SEO, web traffic, "panel balance", reviews and dozens
 * of near-identical variants of the same Instagram followers offer. Rendering
 * that raw would bury the shop under a thousand cards, ship a megabyte of JSON
 * to a phone and put categories on sale that Pryva does not sell.
 *
 * So a service is listed only when it is:
 *   • on one of the seven social platforms the hub knows, by name or category;
 *   • one of the four intents the chips filter by — followers, likes, views,
 *     subscribers;
 *   • priced, because an unpriced card cannot take money.
 *
 * And exactly one offer survives per platform+intent: the cheapest, preferring
 * one that includes a refill, because a boost that silently drops off in a day is
 * not the same product at a lower price. The purchase page then sells that offer
 * by quantity.
 *
 * The panel's identity is irrelevant to every rule here, so the same selection
 * works for any supplier.
 */
export function selectBoostServices(services: SmmService[], snapshotCurrency: string | null): BoostSelection {
  type Candidate = { service: SmmService; listing: BoostListing };
  const best = new Map<string, Candidate>();

  for (const service of services) {
    const listing = describeBoost(service, snapshotCurrency);
    if (!listing.platform) continue;
    if (!LISTED_TAGS.has(listing.tag)) continue;
    if (listing.perThousand === null) continue;

    const key = `${listing.platform}|${listing.tag}`;
    const current = best.get(key);
    if (!current || beats(listing, service, current.listing, current.service)) {
      best.set(key, { service, listing });
    }
  }

  return { services: [...best.values()].map((entry) => entry.service), considered: services.length, listed: best.size };
}

/**
 * Offer quality order: a refill-included service wins outright, then the cheaper
 * thousand units, then the smaller minimum order (the lower entry price).
 */
function beats(listing: BoostListing, service: SmmService, other: BoostListing, otherService: SmmService): boolean {
  if (service.refill !== otherService.refill) return service.refill;
  const price = listing.perThousand ?? Number.POSITIVE_INFINITY;
  const otherPrice = other.perThousand ?? Number.POSITIVE_INFINITY;
  if (price !== otherPrice) return price < otherPrice;
  return (listing.min ?? Number.POSITIVE_INFINITY) < (other.min ?? Number.POSITIVE_INFINITY);
}

/**
 * Boosting targets a profile or post URL rather than a country, so listings are
 * not country-specific and are shown for every selection.
 *
 * `stock` stays null: a panel reports a per-order maximum, not inventory, and
 * the two must not be confused. `price` is the retail cost of the supplier's
 * minimum quantity and the card says "from", because the customer chooses how
 * many units to buy.
 */
export function boostItems(snapshot: BoostSnapshot): ExplorerItem[] {
  const items: ExplorerItem[] = [];
  const ids = new Set<string>();

  for (const service of selectBoostServices(snapshot.services, snapshot.currency).services) {
    const listing = describeBoost(service, snapshot.currency);
    if (ids.has(listing.id)) continue;
    ids.add(listing.id);

    // The supplier's minimum is the smallest quantity that can be bought, so it
    // is the only honest "from" price. Without a minimum there is no quantity to
    // price, and the listing stays read-only.
    const price = listing.perThousand !== null && listing.min !== null
      ? totalForQuantity(listing.perThousand, listing.min)
      : null;

    items.push({
      id: listing.id,
      category: "social",
      name: listing.name,
      description: "Social promotion",
      tag: listing.tag,
      platform: listing.platform ?? undefined,
      artwork: listing.artwork,
      source: "live",
      coverage: "not-country-specific",
      stock: null,
      myUnits: null,
      price,
      priceFrom: price !== null,
      action: price !== null ? { label: "Buy boost", href: `/dashboard/services/boost/${listing.id}` } : null,
    });
  }
  return items;
}

/**
 * Resolve a listing from the id the browser holds.
 *
 * The id is a hash of the supplier's service id, so it cannot be inverted; the
 * catalogue is re-read and hashed instead. Pricing is always recomputed here,
 * never taken from the request.
 */
export async function findBoostListing(itemIdValue: string): Promise<{ listing: BoostListing; snapshot: BoostSnapshot } | null> {
  if (!/^live-boost-[0-9a-f]{20}$/.test(itemIdValue)) return null;
  const snapshot = await readBoostSnapshot();
  // The same selection the shop renders: an id outside it must not be buyable,
  // or a stale link could sell something the catalogue has stopped listing.
  for (const service of selectBoostServices(snapshot.services, snapshot.currency).services) {
    const listing = describeBoost(service, snapshot.currency);
    if (listing.id === itemIdValue) return { listing, snapshot };
  }
  return null;
}
