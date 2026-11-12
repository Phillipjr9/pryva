import type { DigitalArtwork } from "@/lib/content/digital-artwork";
import { plans, type Plan } from "@/lib/services/catalog";
import { EXPLORER_COUNTRIES, type ExplorerCountry } from "@/lib/content/explorer-countries";
import type { AirtimeProvider } from "@/lib/services/data/airtime";
import type { BrandSlug } from "@/lib/content/brand-marks";
import { SERVICES, SERVICE_IDS, type ServiceId } from "@/lib/services/registry";

/**
 * The hub's shelves, from the registry rather than a second list.
 *
 * A category that exists here but not in the registry (or the other way round)
 * is a card nobody can open, so the order and the wording have exactly one home.
 */
export const EXPLORER_CATEGORIES: ReadonlyArray<{
  id: ServiceId;
  label: string;
  description: string;
}> = SERVICE_IDS.map((id) => {
  const service = SERVICES.find((entry) => entry.id === id)!;
  return { id, label: service.label, description: service.description };
});

export type ExplorerCategory = ServiceId;
/** Platform vocabularies classify supplier listings. They are not offerings. */
export type ExplorerFilter = ExplorerCategory | "all";
export type ExplorerArtwork =
  | { kind: "digital-product"; art: DigitalArtwork | null }
  | { kind: "brand"; name: BrandSlug | "disney-plus" }
  | { kind: "service"; name: "numbers" | "esim" | "proxies" | "email-otp" | "accounts" | "bulk" | "scheduled" | "social-promotion" | "gift-cards" | "subscriptions" | "data" | "games" | "topups" | "prepaid" }
  /**
   * An inbox whose provider we could not identify. It is deliberately not
   * `email-otp`: that glyph belongs to the "Temporary inbox" card, and a grid
   * where an unknown provider wears the same mark as the free tool is the
   * duplicate-logo complaint all over again, one level down.
   */
  | { kind: "unidentified-inbox" }
  /**
   * A site listing with a public domain but no bundled brand mark. Load the
   * site's real favicon rather than showing the same envelope on every tile.
   */
  | { kind: "site-favicon"; domain: string }
  /** A real, pinned Simple Icons mark matched by its exact published title. */
  | { kind: "simple-icon"; slug: string; hex: string; version: string }
  /** A locally bundled, reviewed brand mark from an allowlisted source. */
  | { kind: "verified-brand-logo"; slug: string; format?: "png" }
  | { kind: "network"; name: AirtimeProvider };
export type ExplorerItem = {
  id: string;
  category: ExplorerCategory;
  name: string;
  description: string;
  tag: string;
  /** Platform identity is separate from the selected promotion type. */
  platform?: string;
  /** Additional verified catalogue metadata for search, not a coverage promise. */
  searchTerms?: string;
  /**
   * What distinguishes this listing from others of the same type on the same
   * platform — refill, order bounds, rate per thousand. Shown in place of the
   * coverage line, which says nothing useful for a boost.
   */
  detail?: string;
  artwork: ExplorerArtwork;
  /** Only real catalogue, tool or supplier entries are shown. */
  source: "catalog" | "tool" | "live";
  coverage: "catalog-country" | "unconfirmed" | "not-country-specific";
  /** Unknown counts must stay null, never become zero or an invented figure. */
  stock: number | null;
  myUnits: number | null;
  price: number | null;
  priceFrom?: boolean;
  /** Verified identical product, denomination, currency and redemption region. */
  giftCardEquivalenceKey?: string;
  action: { label: string; href: string } | null;
  /** This listing is browse-only until its checkout is enabled. */
  orderingPaused?: boolean;
  /** An explicitly labelled result from a search across all digital categories. */
  crossCategorySearch?: boolean;
  /** A reviewed product whose service family is not established; All view only. */
  allOnly?: boolean;
};

export const VERIFICATION_EXAMPLES: Array<{ name: string; brand: BrandSlug; tag: string }> = [
  // Messaging
  { name: "WhatsApp", brand: "whatsapp", tag: "Messaging" },
  { name: "Telegram", brand: "telegram", tag: "Messaging" },
  { name: "Signal", brand: "signal", tag: "Messaging" },
  { name: "Discord", brand: "discord", tag: "Messaging" },
  { name: "Viber", brand: "viber", tag: "Messaging" },
  { name: "Line", brand: "line", tag: "Messaging" },
  { name: "WeChat", brand: "wechat", tag: "Messaging" },
  { name: "KakaoTalk", brand: "kakaotalk", tag: "Messaging" },
  { name: "Messenger", brand: "messenger", tag: "Messaging" },

  // Social & Community
  { name: "Instagram", brand: "instagram", tag: "Social" },
  { name: "TikTok", brand: "tiktok", tag: "Social" },
  { name: "Facebook", brand: "facebook", tag: "Social" },
  { name: "X", brand: "x", tag: "Social" },
  { name: "Snapchat", brand: "snapchat", tag: "Social" },
  { name: "Threads", brand: "threads", tag: "Social" },
  { name: "Reddit", brand: "reddit", tag: "Social" },
  { name: "Pinterest", brand: "pinterest", tag: "Social" },
  { name: "VK", brand: "vk", tag: "Social" },
  { name: "Tumblr", brand: "tumblr", tag: "Social" },
  { name: "Quora", brand: "quora", tag: "Social" },
  { name: "Medium", brand: "medium", tag: "Social" },
  { name: "Substack", brand: "substack", tag: "Social" },
  { name: "Patreon", brand: "patreon", tag: "Social" },
  { name: "Kuaishou", brand: "kuaishou", tag: "Social" },
  { name: "Bilibili", brand: "bilibili", tag: "Social" },
  { name: "Sina Weibo", brand: "sinaweibo", tag: "Social" },
  { name: "Tinder", brand: "tinder", tag: "Social" },
  { name: "Badoo", brand: "badoo", tag: "Social" },
  { name: "OkCupid", brand: "okcupid", tag: "Social" },

  // Work, AI & Productivity
  { name: "Google", brand: "google", tag: "Work & other" },
  { name: "ChatGPT", brand: "chatgpt", tag: "Work & other" },
  { name: "Claude", brand: "anthropic", tag: "Work & other" },
  { name: "Perplexity", brand: "perplexity", tag: "Work & other" },
  { name: "LinkedIn", brand: "linkedin", tag: "Work & other" },
  { name: "GitHub", brand: "github", tag: "Work & other" },
  { name: "GitLab", brand: "gitlab", tag: "Work & other" },
  { name: "Notion", brand: "notion", tag: "Work & other" },
  { name: "Zoom", brand: "zoom", tag: "Work & other" },
  { name: "Canva", brand: "canva", tag: "Work & other" },
  { name: "Figma", brand: "figma", tag: "Work & other" },
  { name: "Apple", brand: "apple", tag: "Work & other" },
  { name: "Proton Mail", brand: "protonmail", tag: "Work & other" },
  { name: "Zoho", brand: "zoho", tag: "Work & other" },
  { name: "Mail.ru", brand: "maildotru", tag: "Work & other" },
  { name: "eBay", brand: "ebay", tag: "Work & other" },
  { name: "AliExpress", brand: "aliexpress", tag: "Work & other" },
  { name: "Shopify", brand: "shopify", tag: "Work & other" },
  { name: "Etsy", brand: "etsy", tag: "Work & other" },
  { name: "Naver", brand: "naver", tag: "Work & other" },
  { name: "Baidu", brand: "baidu", tag: "Work & other" },

  // Finance & Crypto
  { name: "Binance", brand: "binance", tag: "Finance" },
  { name: "PayPal", brand: "paypal", tag: "Finance" },
  { name: "Coinbase", brand: "coinbase", tag: "Finance" },
  { name: "OKX", brand: "okx", tag: "Finance" },
  { name: "Revolut", brand: "revolut", tag: "Finance" },
  { name: "Cash App", brand: "cashapp", tag: "Finance" },
  { name: "Venmo", brand: "venmo", tag: "Finance" },
  { name: "Wise", brand: "wise", tag: "Finance" },
  { name: "Stripe", brand: "stripe", tag: "Finance" },
  { name: "KuCoin", brand: "kucoin", tag: "Finance" },
  { name: "Payoneer", brand: "payoneer", tag: "Finance" },
  { name: "Klarna", brand: "klarna", tag: "Finance" },
  { name: "Afterpay", brand: "afterpay", tag: "Finance" },
  { name: "Alipay", brand: "alipay", tag: "Finance" },

  // Travel & Delivery
  { name: "Uber", brand: "uber", tag: "Travel" },
  { name: "Uber Eats", brand: "ubereats", tag: "Travel" },
  { name: "DoorDash", brand: "doordash", tag: "Travel" },
  { name: "Deliveroo", brand: "deliveroo", tag: "Travel" },
  { name: "Grab", brand: "grab", tag: "Travel" },
  { name: "Lyft", brand: "lyft", tag: "Travel" },
  { name: "Airbnb", brand: "airbnb", tag: "Travel" },
  { name: "Booking.com", brand: "booking", tag: "Travel" },
  { name: "Expedia", brand: "expedia", tag: "Travel" },
  { name: "Tripadvisor", brand: "tripadvisor", tag: "Travel" },
  { name: "Trip.com", brand: "tripdotcom", tag: "Travel" },

  // Entertainment & Gaming
  { name: "YouTube", brand: "youtube", tag: "Entertainment" },
  { name: "Netflix", brand: "netflix", tag: "Entertainment" },
  { name: "Spotify", brand: "spotify", tag: "Entertainment" },
  { name: "Steam", brand: "steam", tag: "Entertainment" },
  { name: "Twitch", brand: "twitch", tag: "Entertainment" },
  { name: "Kick", brand: "kick", tag: "Entertainment" },
  { name: "SoundCloud", brand: "soundcloud", tag: "Entertainment" },
  { name: "Crunchyroll", brand: "crunchyroll", tag: "Entertainment" },
  { name: "Deezer", brand: "deezer", tag: "Entertainment" },
  { name: "Audiomack", brand: "audiomack", tag: "Entertainment" },
  { name: "Roblox", brand: "roblox", tag: "Entertainment" },
  { name: "PlayStation", brand: "playstation", tag: "Entertainment" },
  { name: "Epic Games", brand: "epicgames", tag: "Entertainment" },
  { name: "Riot Games", brand: "riotgames", tag: "Entertainment" },
  { name: "Battle.net", brand: "battledotnet", tag: "Entertainment" },
  { name: "Vimeo", brand: "vimeo", tag: "Entertainment" },
  { name: "Dailymotion", brand: "dailymotion", tag: "Entertainment" },
];

/** Exported so live supplier listings reuse the same platform/brand vocabulary. */
export const PROMOTION_EXAMPLES: Array<{ name: string; brand: BrandSlug; types: string[] }> = [
  { name: "Instagram", brand: "instagram", types: ["Followers", "Likes", "Views", "Comments", "Shares", "Saves"] },
  { name: "TikTok", brand: "tiktok", types: ["Followers", "Likes", "Views", "Shares", "Comments", "Saves"] },
  { name: "YouTube", brand: "youtube", types: ["Subscribers", "Likes", "Views", "Comments", "Watch time", "Shares"] },
  { name: "Facebook", brand: "facebook", types: ["Followers", "Likes", "Views", "Shares", "Comments", "Reactions"] },
  { name: "X", brand: "x", types: ["Followers", "Likes", "Views", "Shares", "Comments"] },
  { name: "Telegram", brand: "telegram", types: ["Subscribers", "Members", "Views", "Reactions"] },
  { name: "Spotify", brand: "spotify", types: ["Plays", "Followers", "Saves"] },
  { name: "Discord", brand: "discord", types: ["Members"] },
  { name: "LinkedIn", brand: "linkedin", types: ["Followers", "Likes", "Connections"] },
  { name: "Snapchat", brand: "snapchat", types: ["Followers", "Views"] },
  { name: "Reddit", brand: "reddit", types: ["Likes", "Members"] },
  { name: "Pinterest", brand: "pinterest", types: ["Followers", "Saves"] },
  { name: "Twitch", brand: "twitch", types: ["Followers", "Views"] },
  { name: "Threads", brand: "threads", types: ["Followers", "Likes", "Shares"] },
  { name: "SoundCloud", brand: "soundcloud", types: ["Plays", "Followers", "Likes"] },
  { name: "Kick", brand: "kick", types: ["Followers", "Views"] },
];

const categoryById = new Map(EXPLORER_CATEGORIES.map((category) => [category.id, category]));
const countryByCode = new Map(EXPLORER_COUNTRIES.map((country) => [country.code, country]));
const countryByName = new Map(EXPLORER_COUNTRIES.map((country) => [country.name.toLowerCase(), country]));

export function explorerCountry(value: unknown): ExplorerCountry | null {
  return typeof value === "string" ? countryByCode.get(value.toLowerCase()) ?? null : null;
}

export function explorerCategory(value: unknown): ExplorerFilter {
  return typeof value === "string" && categoryById.has(value as ExplorerCategory)
    ? (value as ExplorerCategory)
    : "all";
}

/** Exact country names only; vague regional labels don't prove coverage. */
export function planCountry(plan: Plan): ExplorerCountry | null {
  return countryByName.get(plan.region.trim().toLowerCase()) ?? null;
}

const ambiguousPlanRegions = new Set([
  "Any 5 countries",
  "Africa (12 countries)",
  "Europe (38 countries)",
  "Global (120+ countries)",
  "Europe",
]);

/**
 * The legacy plan-details route only offers exact-country, single-unit plans.
 * Bundle plans are not mapped to a purchasable detail page, and a country name
 * alone does not establish live coverage.
 */
const noPreviewCheckout = new Set(["vn-otp-5"]);

export function planMatchesCountry(plan: Plan, countryCode: string): boolean {
  const country = explorerCountry(countryCode);
  if (!country) return false;
  return planCountry(plan)?.code === country.code;
}

/** Only exact-region or country-independent single plans have a faithful preview path. */
export function canPreviewPlan(plan: Plan, countryCode: string): boolean {
  return planMatchesCountry(plan, countryCode) && !noPreviewCheckout.has(plan.slug);
}

const planCategories: Partial<Record<Plan["service"], ExplorerCategory>> = {
  numbers: "numbers",
  esim: "esim",
  // Proxies are a live provider catalogue, not the old static planning samples.
  // email-otp is absent: a free inbox is not a catalogue plan, so it has no plan
  // rows to map. Live inbox availability reaches the explorer through
  // supplierItemsForCountry instead, already categorised as "email".
};

function planItems(country: ExplorerCountry): ExplorerItem[] {
  return plans.flatMap((plan): ExplorerItem[] => {
    const category = planCategories[plan.service];
    if (!category) return [];
    // eSIM and proxy plans come from authenticated supplier catalogues rather
    // than this static builder. The explorer does not fabricate stale offers.
    if (plan.service === "esim" || plan.service === "proxies") return [];
    const matches = planMatchesCountry(plan, country.code);
    const ambiguous = ambiguousPlanRegions.has(plan.region);
    if (!matches && !ambiguous) return [];
    const coverage = matches ? "catalog-country" : "unconfirmed";
    const categoryTag = plan.service === "numbers"
      ? plan.slug.startsWith("rent-") ? "Rental" : plan.slug === "vn-otp-5" ? "Bundle" : "Single use"
      : categoryById.get(category)?.label ?? "Plan";
    return [{
      id: `plan-${plan.slug}`,
      category,
      name: plan.name,
      description: plan.planLabel,
      tag: categoryTag,
      artwork: { kind: "service", name: plan.service as "numbers" | "esim" | "proxies" | "email-otp" },
      source: "catalog",
      coverage,
      stock: null,
      myUnits: null,
      price: plan.price,
      action: canPreviewPlan(plan, country.code)
        ? { label: "View plan", href: `/dashboard/services/plan/${encodeURIComponent(plan.slug)}?country=${country.code}` }
        : null,
    }];
  });
}

function additionalItems(_country: ExplorerCountry): ExplorerItem[] {
  const other: ExplorerItem[] = [
    {
      id: "call-of-duty-browser", category: "games", name: "Call of Duty: Mobile CP",
      description: "Browse game top-ups by account region", tag: "Game top-up",
      artwork: { kind: "digital-product", art: null }, source: "tool", coverage: "unconfirmed",
      stock: null, myUnits: null, price: null,
      action: { label: "Browse Call of Duty top-ups", href: "/dashboard/call-of-duty-mobile" },
    },
    {
      id: "pryva-wallet-gifts", category: "gift-cards", name: "Pryva gift cards",
      description: "Send or redeem Pryva wallet credit", tag: "Wallet gift card",
      artwork: { kind: "service", name: "gift-cards" }, source: "tool", coverage: "not-country-specific",
      stock: null, myUnits: null, price: null,
      action: { label: "Send or redeem Pryva credit", href: "/dashboard/gift-cards" },
    },
    {
      // A free tool rather than a product, shaped like the order tools below for
      // the same reason: no price because nothing is charged, no stock because
      // we do not sell units, no country because an address is not regional.
      // It also keeps the email category present in the explorer now that the
      // four paid inbox tiers are gone -- a category with no item at all would
      // be a silent hole where a service family used to be.
      id: "temporary-inbox", category: "email", name: "Temporary inbox",
      description: "Free disposable address, one at a time", tag: "Free",
      artwork: { kind: "service", name: "email-otp" },
      source: "tool", coverage: "not-country-specific", stock: null, myUnits: null, price: null,
      action: { label: "Open temporary inbox", href: "/dashboard/inbox" },
    },
    {
      id: "account-marketplace", category: "accounts", name: "Social & Digital Accounts",
      description: "Buy social media, email and other accounts; aged accounts where listed", tag: "Account listings", artwork: { kind: "service", name: "accounts" },
      source: "catalog", coverage: "unconfirmed", stock: null, myUnits: null, price: null,
      action: { label: "Browse social & digital accounts", href: "/dashboard/accounts" },
    },
    {
      id: "residential-proxies", category: "proxies", name: "Residential proxies",
      description: "Browse live plans by country and state", tag: "Proxy plans", artwork: { kind: "service", name: "proxies" },
      source: "live", coverage: "unconfirmed", stock: null, myUnits: null, price: null,
      action: { label: "Browse live proxy plans", href: "/dashboard/proxies" },
    },
    {
      id: "bulk-orders", category: "tools", name: "Bulk orders",
      description: "Group catalog plans into one order", tag: "Order tool", artwork: { kind: "service", name: "bulk" },
      source: "tool", coverage: "not-country-specific", stock: null, myUnits: null, price: null,
      action: { label: "Open bulk orders", href: "/dashboard/bulk-orders" },
    },
    {
      id: "scheduled-orders", category: "tools", name: "Scheduled orders",
      description: "Manage recurring orders", tag: "Order tool", artwork: { kind: "service", name: "scheduled" },
      source: "tool", coverage: "not-country-specific", stock: null, myUnits: null, price: null,
      action: { label: "Open schedules", href: "/dashboard/scheduled" },
    },
  ];
  return other;
}

/**
 * Mix independent catalogue feeds within each service family before mixing
 * the families themselves. A large feed must not push another supplier's
 * offers behind hundreds of cards. Keep the original offers and checkout
 * links: similar names do not prove that two plans are interchangeable.
 */
export function mergeExplorerSources(sources: readonly ExplorerItem[][]): ExplorerItem[] {
  const combined: ExplorerItem[] = [];
  for (const { id } of EXPLORER_CATEGORIES) {
    const groups = sources.map((source) => source.filter((item) => item.category === id));
    for (let index = 0; groups.some((group) => index < group.length); index++) {
      for (const group of groups) if (group[index]) combined.push(group[index]);
    }
  }
  return interleaveExplorerItems(combined);
}

/** Only compare priced, orderable offers with an explicitly verified identical
 * product and terms. Unknown prices, coverage, or availability never hide an offer. */
export function cheapestVerifiedGiftCards(items: ExplorerItem[]): ExplorerItem[] {
  const best = new Map<string, ExplorerItem>();
  for (const item of items) {
    if (item.category !== "gift-cards" || !item.giftCardEquivalenceKey || item.price === null || !Number.isFinite(item.price) || item.price < 0 || item.priceFrom || !item.action || item.orderingPaused) continue;
    const old = best.get(item.giftCardEquivalenceKey);
    if (!old || item.price < old.price!) best.set(item.giftCardEquivalenceKey, item);
  }
  return items.filter((item) => {
    if (item.category !== "gift-cards" || !item.giftCardEquivalenceKey || item.price === null || !Number.isFinite(item.price) || item.price < 0 || item.priceFrom || !item.action || item.orderingPaused) return true;
    return best.get(item.giftCardEquivalenceKey) === item;
  });
}

/**
 * Keep service families in their own shelf rather than shuffling a large feed
 * across unrelated categories. The All view is still ordered by family, but it
 * never mixes one service's cards into the middle of another family's rows.
 */
export function interleaveExplorerItems(items: ExplorerItem[]): ExplorerItem[] {
  return EXPLORER_CATEGORIES.flatMap((category) => items.filter((item) => item.category === category.id));
}

export function buildServiceExplorer(countryCode: string | null): ExplorerItem[] {
  const country = explorerCountry(countryCode);
  if (!country) return [];
  return interleaveExplorerItems([...planItems(country), ...additionalItems(country)]);
}

export function filterExplorerItems(items: ExplorerItem[], category: ExplorerFilter, search: string, tag = "all"): ExplorerItem[] {
  const query = search.trim().toLocaleLowerCase();
  return items.filter((item) => {
    if (category !== "all" && (item.allOnly || item.category !== category)) return false;
    if (tag !== "all" && item.tag !== tag) return false;
    if (!query) return true;
    const categoryLabel = item.crossCategorySearch ? "" : categoryById.get(item.category)?.label ?? "";
    return [item.name, item.description, item.tag, item.platform ?? "", item.detail ?? "", item.searchTerms ?? "", categoryLabel]
      .some((value) => value.toLocaleLowerCase().includes(query));
  });
}
