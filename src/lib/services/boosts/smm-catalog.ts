import "server-only";
import { createHash } from "node:crypto";
import { isFundingFailure } from "@/lib/providers/types";
import {
  getSmmBalance,
  isSmmPanelConfigured,
  listSmmServices,
  smmPanelApiUrlSetting,
  type SmmService,
} from "@/lib/providers/smm-panel";
import type { BrandSlug } from "@/lib/content/brand-marks";
import { formatNaira } from "@/lib/services/catalog";
import { PROMOTION_EXAMPLES, type ExplorerItem } from "@/lib/services/service-explorer";
import { socialArtwork } from "@/lib/services/boosts/social-artwork";
import { normalizeCurrency, retailPerThousand, totalForQuantity } from "@/lib/services/boosts/smm-pricing";

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
  /** "funding" cannot be retried away; "outage" can. Null when the read is whole. */
  degraded: "funding" | "outage" | null;
  /**
   * The balance read failed, so the panel's billing currency is unknown.
   *
   * Kept apart from `partial`: a failed balance read does not remove service
   * listings. Without a service-specific currency, prices remain unavailable.
   */
  balanceUnavailable: boolean;
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
    // fatal — but keep an unfunded-account refusal intact, because it is not an
    // outage and the hub must not offer a Retry for it.
    if (services.status === "rejected") {
      if (isFundingFailure(services.reason)) throw services.reason;
      throw new Error("Boosting catalog unavailable");
    }
    const settled = balance.status === "fulfilled" ? balance.value : null;
    const snapshot: BoostSnapshot = {
      // The adapter already has a bounded input limit. A second 2,000-row
      // slice here silently hid valid listings returned by that adapter.
      services: services.value,
      currency: settled?.currency ?? null,
      balance: settled?.balance ?? null,
      partial: false,
      degraded: null,
      balanceUnavailable: balance.status === "rejected",
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

/**
 * The intent a service actually sells.
 *
 * The name is the product; the category is only the shelf it sits on. Reading
 * them as one string made a followers offer filed under "Instagram Followers &
 * Likes" come back as Likes, which merged it into a different product entirely.
 * So the name is read on its own first, and the category is only consulted when
 * the name says nothing.
 *
 * Within one string the earliest mention wins rather than a fixed priority.
 * "Instagram Followers | 24 hours" is a followers offer that happens to promise
 * a turnaround, not watch time — and "YouTube Watch time | 4000 hours" is still
 * watch time, because that is what it says first.
 */
function firstIntentIn(text: string): string | null {
  let found: { tag: string; index: number } | null = null;
  for (const candidate of BOOST_TAGS) {
    // These patterns carry no /g, so exec is stateless and safe to reuse.
    const match = candidate.pattern.exec(text);
    if (match && (found === null || match.index < found.index)) {
      found = { tag: candidate.tag, index: match.index };
    }
  }
  return found?.tag ?? null;
}

function boostTag(service: SmmService, displayName: string): string {
  const intent = firstIntentIn(service.name ?? "")
    ?? firstIntentIn(service.category ?? "")
    ?? firstIntentIn(displayName);
  if (intent) return intent;
  // Unmatched services keep their own label if readable.
  const fromCategory = readable(service.category, 24);
  if (fromCategory) return fromCategory;
  const fromType = readable(service.type, 24);
  return fromType && !UNINFORMATIVE_TYPES.includes(fromType.toLowerCase()) ? fromType : "Other";
}

/* ------------------------------------------------------------------ */
/* Platform vocabulary                                                 */
/* ------------------------------------------------------------------ */

/**
 * Every social platform the shop will list, which is wider than the set it has
 * artwork for.
 *
 * `PROMOTION_EXAMPLES` is the sixteen platforms the hub markets. A real
 * catalogue also sells VK, Kwai, Likee, Audiomack and a long tail of regional
 * services, and restricting the shop to the marketed sixteen hid most of a
 * supplier's inventory. A platform without a redistributable mark is still
 * listed, with a generic glyph in place of a logo.
 */
type SocialPlatform = { name: string; brand: BrandSlug | null; aliases?: readonly string[] };

const EXTRA_SOCIAL_PLATFORMS: readonly SocialPlatform[] = [
  { name: "WhatsApp", brand: "whatsapp" },
  { name: "VK", brand: "vk", aliases: ["VKontakte"] },
  { name: "Tumblr", brand: "tumblr" },
  { name: "Quora", brand: "quora" },
  { name: "Kuaishou", brand: "kuaishou" },
  { name: "Bilibili", brand: "bilibili" },
  { name: "Sina Weibo", brand: "sinaweibo", aliases: ["Weibo"] },
  { name: "Vimeo", brand: "vimeo" },
  { name: "Dailymotion", brand: "dailymotion" },
  { name: "Audiomack", brand: "audiomack" },
  { name: "Deezer", brand: "deezer" },
  { name: "Patreon", brand: "patreon" },
  { name: "Substack", brand: "substack" },
  // Sold by panels, but no mark we can redistribute.
  { name: "Kwai", brand: null },
  { name: "Likee", brand: null },
  { name: "Rumble", brand: null },
  { name: "Trovo", brand: null },
  { name: "Bigo Live", brand: null, aliases: ["Bigo"] },
  { name: "Clubhouse", brand: null },
  { name: "Tidal", brand: null },
  { name: "Boomplay", brand: null },
  { name: "Anghami", brand: null },
  { name: "Apple Music", brand: null },
  { name: "YouTube Music", brand: null },
  { name: "Nimo TV", brand: null, aliases: ["Nimo"] },
  { name: "Odysee", brand: null },
  { name: "Tango", brand: null },
  { name: "Mixcloud", brand: null },
  { name: "Shazam", brand: null },
  // Deliberately absent: "Medium". Panels write "medium quality" far more often
  // than they sell the publishing site, so matching it renamed followers offers.
];

const SOCIAL_PLATFORMS: readonly SocialPlatform[] = [
  ...PROMOTION_EXAMPLES.map((entry) => ({ name: entry.name, brand: entry.brand as BrandSlug | null })),
  ...EXTRA_SOCIAL_PLATFORMS,
];

/**
 * Longest term first, so "YouTube Music" is recognised before "YouTube" and a
 * music offer is not filed under the video platform. Ties keep vocabulary order,
 * which is the order the shop groups in.
 */
const PLATFORM_MATCHERS = SOCIAL_PLATFORMS
  .map((platform, rank) => ({ platform, rank, terms: [platform.name, ...(platform.aliases ?? [])] }))
  .sort((a, b) =>
    Math.max(...b.terms.map((term) => term.length)) - Math.max(...a.terms.map((term) => term.length)));

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

type DetectedPlatform = { name: string; brand: BrandSlug | null; rank: number };

/**
 * Inventory that is not a social boost at all.
 *
 * Widening the platform set to "anything the supplier sells" would put website
 * traffic, SEO and review packages on sale, which Pryva does not offer. These
 * are refused by name even when they mention a social platform.
 */
const NON_SOCIAL = /\bseo\b|\bwebsite\s+traffic\b|\bweb\s+traffic\b|\bbacklinks?\b|\bsearch\s+engine\b|\breviews?\b|\btrustpilot\b|\bgoogle\s+maps\b|\bhosting\b|\bvpn\b|\bprox(?:y|ies)\b/i;

/** Category words that name a shelf, not a platform. */
const UNINFORMATIVE_CATEGORIES = new Set([
  ...UNINFORMATIVE_TYPES, "new", "hot", "best", "cheap", "popular", "promotion", "promotions", "social", "other", "others", "misc",
]);

/** Intent words stripped from a category to leave the platform behind. */
const INTENT_WORDS = /\b(followers?|fans|likes?|views?|subscribers?|comments?|shares?|reposts?|retweets?|saves?|bookmarks?|members?|plays?|streams?|reactions?|emojis?|upvotes?|impressions?|watch\s*time|watchtime|hours|connections)\b/gi;

/**
 * A platform the vocabulary does not know still gets listed, grouped under the
 * supplier's own category rather than dropped — that is the difference between
 * "every social platform" and "the sixteen we drew logos for".
 */
function platformLabelFrom(value: string | null): string | null {
  const raw = readable(value, 60);
  if (!raw) return null;
  const head = raw.split(/\s*[-–|:•/]\s*/)[0]?.trim() ?? "";
  const stripped = head.replace(INTENT_WORDS, "").replace(/\s+/g, " ").trim();
  if (!stripped || stripped.length > 32) return null;
  return UNINFORMATIVE_CATEGORIES.has(stripped.toLowerCase()) ? null : stripped;
}

function fallbackPlatform(service: SmmService): DetectedPlatform {
  // The category is the shelf, so it names the platform best. When it is
  // generic or unusable, the product's own words usually still carry it:
  // "Myspace Plays" is a Myspace offer even if the shelf just says "Default".
  const name = platformLabelFrom(service.category) ?? platformLabelFrom(service.name) ?? "Other platforms";
  return { name, brand: null, rank: Number.MAX_SAFE_INTEGER };
}

function detectPlatform(service: SmmService): DetectedPlatform | null {
  const text = `${service.name ?? ""} ${service.category ?? ""}`;
  if (NON_SOCIAL.test(text)) return null;
  // The actual listing is more specific than the supplier's broad shelf.
  // For example, Threads and TikTok products can be filed under Instagram.
  // Matching both strings together incorrectly gives them Instagram's logo.
  for (const part of [service.name ?? "", service.category ?? ""]) {
    for (const candidate of PLATFORM_MATCHERS) {
      if (candidate.terms.some((term) => matchesPlatform(part, term))) {
        return { name: candidate.platform.name, brand: candidate.platform.brand, rank: candidate.rank };
      }
    }
  }
  // Unknown platform: only list it when it is genuinely selling a social intent.
  // Without one this is traffic, reviews or something else we do not sell.
  if (!firstIntentIn(service.name ?? "") && !firstIntentIn(service.category ?? "")) return null;
  return fallbackPlatform(service);
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
  /** Sort key for the shop's platform sections; unknown platforms sort last. */
  platformRank: number;
  artwork: ExplorerItem["artwork"];
  perThousand: number | null;
  min: number | null;
  max: number | null;
  currency: string | null;
  refill: boolean;
  /**
   * What makes this offer different from the next one on the same shelf.
   *
   * Now that every variant is listed rather than one per platform and intent,
   * two cards can legitimately share a name. Refill, order bounds and the rate
   * per thousand are what a customer actually chooses between, so they belong
   * on the card rather than only behind it.
   */
  detail: string;
};

/** Bounds and rates are the differentiator between variants, so format them once. */
function count(value: number): string {
  return value.toLocaleString("en-NG");
}

export function describeBoost(service: SmmService, snapshotCurrency: string | null): BoostListing {
  const platform = detectPlatform(service);
  // Panel names carry the variant ("| 30 days refill | max 100k"), so the old
  // 70-character ceiling discarded exactly the text that told offers apart.
  const cleanName = readable(service.name, 110);
  const tag = boostTag(service, cleanName ?? "");
  // A category is a grouping label, not a product name: "Instagram" on its own
  // does not tell a customer what they would be buying. So when the panel's own
  // name is unusable or would reveal provenance, synthesize one from the
  // platform and the derived type. Coverage never depends on how a panel words
  // its catalog.
  const name = cleanName ?? `${platform?.name ?? "Social"} ${tag.toLowerCase()}`;
  const currency = normalizeCurrency(service.currency) ? service.currency : snapshotCurrency;
  const perThousand = retailPerThousand({ wholesaleRatePerThousand: service.ratePer1000, currency });

  const parts = [service.refill ? "Refill included" : "No refill"];
  if (service.min !== null && service.max !== null) parts.push(`${count(service.min)}–${count(service.max)} units`);
  else if (service.min !== null) parts.push(`from ${count(service.min)} units`);
  if (perThousand !== null) parts.push(`${formatNaira(perThousand)} per 1,000`);

  return {
    id: itemId(service.id),
    serviceId: service.id,
    name,
    tag,
    platform: platform?.name ?? null,
    platformRank: platform?.rank ?? Number.MAX_SAFE_INTEGER,
    // A platform we have no mark for gets the promotion glyph, not another
    // platform's logo and not a blank tile.
    artwork: platform?.brand
      ? { kind: "brand", name: platform.brand }
      : socialArtwork(platform?.name ?? null, cleanName) ?? { kind: "service", name: "social-promotion" },
    perThousand,
    min: service.min,
    max: service.max,
    currency: normalizeCurrency(currency),
    refill: service.refill,
    detail: parts.join(" · "),
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
  /** Every sellable offer, ordered by platform, intent and price. */
  services: SmmService[];
  /** How many the panel returned. */
  considered: number;
  /** How many of those survived selection. */
  listed: number;
};

/**
 * Everything the supplier sells that Pryva can actually put on a shelf.
 *
 * This used to keep one offer per platform and intent — the cheapest with a
 * refill — and discard the rest. On a real catalogue of 300+ services that
 * surfaced 17 cards and hid the other 95% of the inventory, including every
 * speed, quality and refill variant a customer might reasonably prefer. The
 * shop now paginates, searches and groups by platform, so the size of a panel's
 * catalogue is no longer a reason to throw stock away.
 *
 * A service is listed when it is:
 *   • a social platform, known or otherwise — the vocabulary is wider than the
 *     set we ship logos for, and an unknown one is grouped under its category;
 *   • one of the intents the chips filter by (`LISTED_TAGS`);
 *   • not traffic, SEO or reviews, which Pryva does not sell;
 *   • priced by default, because an unpriced card cannot take money; the
 *     explorer can opt into displaying these entries without a purchase action.
 *
 * Nothing is collapsed. The only rows dropped are duplicates of a service id
 * already listed, which are the same product rather than a variant of it.
 *
 * The panel's identity is irrelevant to every rule here, so the same selection
 * works for any supplier.
 */
export function selectBoostServices(services: SmmService[], snapshotCurrency: string | null, options: { includeUnpriced?: boolean } = {}): BoostSelection {
  const eligible: Array<{ service: SmmService; listing: BoostListing }> = [];
  const seen = new Set<string>();

  for (const service of services) {
    if (seen.has(service.id)) continue;
    const listing = describeBoost(service, snapshotCurrency);
    if (!listing.platform) continue;
    if (!LISTED_TAGS.has(listing.tag)) continue;
    if (listing.perThousand === null && !options.includeUnpriced) continue;
    seen.add(service.id);
    eligible.push({ service, listing });
  }

  // Platform, then intent, then cheapest first. The shop groups on this order,
  // and a customer comparing variants should meet the lowest price at the top.
  eligible.sort((a, b) => {
    const left = a.listing;
    const right = b.listing;
    if (left.platformRank !== right.platformRank) return left.platformRank - right.platformRank;
    const platform = (left.platform ?? "").localeCompare(right.platform ?? "");
    if (platform !== 0) return platform;
    const tag = left.tag.localeCompare(right.tag);
    if (tag !== 0) return tag;
    const price = (left.perThousand ?? Number.MAX_SAFE_INTEGER) - (right.perThousand ?? Number.MAX_SAFE_INTEGER);
    if (price !== 0) return price;
    const min = (left.min ?? 0) - (right.min ?? 0);
    if (min !== 0) return min;
    return left.serviceId.localeCompare(right.serviceId);
  });

  return { services: eligible.map((entry) => entry.service), considered: services.length, listed: eligible.length };
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

  for (const service of selectBoostServices(snapshot.services, snapshot.currency, { includeUnpriced: true }).services) {
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
      detail: listing.detail,
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
