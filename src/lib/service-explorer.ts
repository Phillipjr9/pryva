import { plans, type Plan } from "@/lib/catalog";
import { EXPLORER_COUNTRIES, type ExplorerCountry } from "@/lib/explorer-countries";
import { dataPlans, type AirtimeProvider } from "@/lib/airtime";
import { digitalServices } from "@/lib/digital-services";
import type { BrandSlug } from "@/lib/brand-marks";

/**
 * Example platforms and illustrative plans remain distinct from supplier
 * listings. Examples must never imply a working mapping, stock, or coverage.
 */
export const EXPLORER_CATEGORIES = [
  { id: "verification", label: "App verification", description: "SMS codes for apps" },
  { id: "social", label: "Social promotion", description: "Followers, likes & views" },
  { id: "numbers", label: "Number plans", description: "Single-use & rentals" },
  { id: "esim", label: "eSIM", description: "Travel data plans" },
  { id: "proxies", label: "Proxies", description: "Residential traffic" },
  { id: "email", label: "Email OTP", description: "Temporary inboxes" },
  { id: "accounts", label: "Digital accounts", description: "Account marketplace" },
  { id: "subscriptions", label: "Subscriptions", description: "Entertainment & tools" },
  { id: "data", label: "Mobile data", description: "Local network plans" },
  { id: "tools", label: "Order tools", description: "Bulk & scheduled orders" },
] as const;

export type ExplorerCategory = (typeof EXPLORER_CATEGORIES)[number]["id"];
export type ExplorerFilter = ExplorerCategory | "all";
export type ExplorerArtwork =
  | { kind: "brand"; name: BrandSlug | "disney-plus" }
  | { kind: "service"; name: "numbers" | "esim" | "proxies" | "email-otp" | "accounts" | "bulk" | "scheduled" }
  | { kind: "network"; name: AirtimeProvider };
export type ExplorerItem = {
  id: string;
  category: ExplorerCategory;
  name: string;
  description: string;
  tag: string;
  /** Platform identity is separate from the selected promotion type. */
  platform?: string;
  artwork: ExplorerArtwork;
  /** A sample is only a type of service, not an offering from a supplier. */
  source: "example" | "catalog" | "tool" | "live";
  coverage: "catalog-country" | "unconfirmed" | "not-country-specific";
  /** Unknown counts must stay null, never become zero or an invented figure. */
  stock: number | null;
  myUnits: number | null;
  price: number | null;
  priceFrom?: boolean;
  action: { label: string; href: string } | null;
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
 * Bundle checkout is modeled separately by the explicitly simulated demo hub;
 * neither path claims verified live supplier coverage.
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
  proxies: "proxies",
  // email-otp is absent: a free inbox is not a catalogue plan, so it has no plan
  // rows to map. Live inbox availability reaches the explorer through
  // supplierItemsForCountry instead, already categorised as "email".
};

function planItems(country: ExplorerCountry): ExplorerItem[] {
  return plans.flatMap((plan): ExplorerItem[] => {
    const category = planCategories[plan.service];
    if (!category) return [];
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

function exampleItems(): ExplorerItem[] {
  const verification: ExplorerItem[] = VERIFICATION_EXAMPLES.map((platform) => ({
    id: `verification-${platform.brand}`,
    category: "verification",
    name: platform.name,
    description: "SMS verification",
    tag: platform.tag,
    platform: platform.name,
    artwork: { kind: "brand", name: platform.brand },
    source: "example",
    coverage: "unconfirmed",
    stock: null,
    myUnits: null,
    price: null,
    action: null,
  }));
  const social: ExplorerItem[] = PROMOTION_EXAMPLES.flatMap((platform) =>
    platform.types.map((type): ExplorerItem => ({
      id: `social-${platform.brand}-${type.toLowerCase().replace(/\s+/g, "-")}`,
      category: "social",
      name: `${platform.name} ${type.toLowerCase()}`,
      description: "Social promotion",
      tag: type,
      platform: platform.name,
      artwork: { kind: "brand", name: platform.brand },
      source: "example",
      coverage: "unconfirmed",
      stock: null,
      myUnits: null,
      price: null,
      action: null,
    })),
  );
  return [...verification, ...social];
}

const PROVIDER_LABELS: Record<AirtimeProvider, string> = {
  mtn: "MTN",
  airtel: "Airtel",
  glo: "Glo",
  "9mobile": "9mobile",
};

function additionalItems(country: ExplorerCountry): ExplorerItem[] {
  const digitalBrands: Record<string, BrandSlug | "disney-plus"> = {
    netflix: "netflix", spotify: "spotify", youtube: "youtube", disney: "disney-plus", chatgpt: "chatgpt", canva: "canva",
  };
  const subscriptions: ExplorerItem[] = digitalServices.flatMap((service): ExplorerItem[] => {
    const brand = digitalBrands[service.slug];
    if (!brand || service.plans.length === 0) return [];
    return [{
      id: `subscription-${service.slug}`,
      category: "subscriptions",
      name: service.name,
      description: `${service.plans.length} catalog plan${service.plans.length === 1 ? "" : "s"}`,
      tag: service.category,
      artwork: { kind: "brand", name: brand },
      source: "catalog",
      coverage: "unconfirmed",
      stock: null,
      myUnits: null,
      price: Math.min(...service.plans.map((plan) => plan.price)),
      priceFrom: true,
      action: { label: "View plans", href: `/dashboard/digital?service=${encodeURIComponent(service.slug)}&country=${country.code}` },
    }];
  });

  // The existing data catalog and checkout support Nigeria only.
  const data: ExplorerItem[] = country.code === "ng"
    ? dataPlans.map((plan) => ({
        id: `data-${plan.id}`,
        category: "data",
        name: plan.name,
        description: `${plan.size} · ${plan.duration}`,
        tag: PROVIDER_LABELS[plan.provider] ?? "Mobile data",
        artwork: { kind: "network", name: plan.provider },
        source: "catalog",
        coverage: "catalog-country",
        stock: null,
        myUnits: null,
        price: plan.price,
        action: { label: "View plan", href: `/dashboard/data?plan=${encodeURIComponent(plan.id)}` },
      }))
    : [];

  const other: ExplorerItem[] = [
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
      id: "account-marketplace", category: "accounts", name: "Account marketplace",
      description: "Browse live listings", tag: "Digital accounts", artwork: { kind: "service", name: "accounts" },
      source: "catalog", coverage: "unconfirmed", stock: null, myUnits: null, price: null,
      action: { label: "Browse accounts", href: "/dashboard/accounts" },
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
  return [...subscriptions, ...data, ...other];
}

/** Interleave categories so the All view doesn't bury whole service families. */
export function interleaveExplorerItems(items: ExplorerItem[]): ExplorerItem[] {
  const groups = EXPLORER_CATEGORIES.map((category) => items.filter((item) => item.category === category.id));
  const result: ExplorerItem[] = [];
  for (let index = 0; groups.some((group) => index < group.length); index++) {
    for (const group of groups) if (group[index]) result.push(group[index]);
  }
  return result;
}

export function buildServiceExplorer(countryCode: string | null): ExplorerItem[] {
  const country = explorerCountry(countryCode);
  if (!country) return [];
  return interleaveExplorerItems([...exampleItems(), ...planItems(country), ...additionalItems(country)]);
}

export function filterExplorerItems(items: ExplorerItem[], category: ExplorerFilter, search: string, tag = "all"): ExplorerItem[] {
  const query = search.trim().toLocaleLowerCase();
  return items.filter((item) => {
    if (category !== "all" && item.category !== category) return false;
    if (tag !== "all" && item.tag !== tag) return false;
    if (!query) return true;
    const categoryLabel = categoryById.get(item.category)?.label ?? "";
    return [item.name, item.description, item.tag, categoryLabel].some((value) => value.toLocaleLowerCase().includes(query));
  });
}
