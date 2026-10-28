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
  { id: "gift-cards", label: "Gift cards", description: "Pryva wallet credit" },
  { id: "tools", label: "Order tools", description: "Bulk & scheduled orders" },
] as const;

export type ExplorerCategory = (typeof EXPLORER_CATEGORIES)[number]["id"];
export type ExplorerFilter = ExplorerCategory | "all";
export type ExplorerArtwork =
  | { kind: "brand"; name: BrandSlug | "disney-plus" }
  | { kind: "service"; name: "numbers" | "esim" | "proxies" | "email-otp" | "accounts" | "gift-cards" | "bulk" | "scheduled" }
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
  { name: "WhatsApp", brand: "whatsapp", tag: "Messaging" },
  { name: "Instagram", brand: "instagram", tag: "Social" },
  { name: "Telegram", brand: "telegram", tag: "Messaging" },
  { name: "TikTok", brand: "tiktok", tag: "Social" },
  { name: "Facebook", brand: "facebook", tag: "Social" },
  { name: "Google", brand: "google", tag: "Work & other" },
  { name: "X", brand: "x", tag: "Social" },
  { name: "Discord", brand: "discord", tag: "Messaging" },
  { name: "Snapchat", brand: "snapchat", tag: "Social" },
  { name: "YouTube", brand: "youtube", tag: "Entertainment" },
  { name: "Binance", brand: "binance", tag: "Finance" },
  { name: "PayPal", brand: "paypal", tag: "Finance" },
  { name: "Uber", brand: "uber", tag: "Travel" },
  { name: "Netflix", brand: "netflix", tag: "Entertainment" },
  { name: "Spotify", brand: "spotify", tag: "Entertainment" },
  { name: "Tinder", brand: "tinder", tag: "Social" },
  { name: "OKX", brand: "okx", tag: "Finance" },
  { name: "Reddit", brand: "reddit", tag: "Social" },
  { name: "Pinterest", brand: "pinterest", tag: "Social" },
  { name: "Twitch", brand: "twitch", tag: "Entertainment" },
  { name: "WeChat", brand: "wechat", tag: "Messaging" },
  { name: "Zoom", brand: "zoom", tag: "Work & other" },
  { name: "Airbnb", brand: "airbnb", tag: "Travel" },
  { name: "Booking.com", brand: "booking", tag: "Travel" },
  { name: "Coinbase", brand: "coinbase", tag: "Finance" },
  { name: "Revolut", brand: "revolut", tag: "Finance" },
  { name: "Cash App", brand: "cashapp", tag: "Finance" },
  { name: "Venmo", brand: "venmo", tag: "Finance" },
  { name: "Steam", brand: "steam", tag: "Entertainment" },
  { name: "Apple", brand: "apple", tag: "Work & other" },
];

const PROMOTION_EXAMPLES: Array<{ name: string; brand: BrandSlug; types: string[] }> = [
  { name: "Instagram", brand: "instagram", types: ["Followers", "Likes", "Views"] },
  { name: "TikTok", brand: "tiktok", types: ["Followers", "Likes", "Views"] },
  { name: "YouTube", brand: "youtube", types: ["Subscribers", "Likes", "Views"] },
  { name: "Facebook", brand: "facebook", types: ["Followers", "Likes", "Views"] },
  { name: "X", brand: "x", types: ["Followers", "Likes", "Views"] },
  { name: "Telegram", brand: "telegram", types: ["Subscribers", "Views"] },
  { name: "Twitch", brand: "twitch", types: ["Followers", "Views"] },
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
const noPreviewCheckout = new Set(["vn-otp-5", "email-bundle", "email-team"]);

export function planMatchesCountry(plan: Plan, countryCode: string): boolean {
  const country = explorerCountry(countryCode);
  if (!country) return false;
  if (plan.service === "email-otp" && plan.region === "Any domain") return true;
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
  "email-otp": "email",
};

function planItems(country: ExplorerCountry): ExplorerItem[] {
  return plans.flatMap((plan): ExplorerItem[] => {
    const category = planCategories[plan.service];
    if (!category) return [];
    const matches = planMatchesCountry(plan, country.code);
    const ambiguous = ambiguousPlanRegions.has(plan.region);
    if (!matches && !ambiguous) return [];
    const coverage = plan.service === "email-otp"
      ? "not-country-specific"
      : matches ? "catalog-country" : "unconfirmed";
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
      id: `social-${platform.brand}-${type.toLowerCase()}`,
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
        tag: "Mobile data",
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
      id: "account-marketplace", category: "accounts", name: "Account marketplace",
      description: "Browse live listings", tag: "Digital accounts", artwork: { kind: "service", name: "accounts" },
      source: "catalog", coverage: "unconfirmed", stock: null, myUnits: null, price: null,
      action: { label: "Browse accounts", href: "/dashboard/accounts" },
    },
    {
      id: "gift-cards", category: "gift-cards", name: "Pryva gift cards",
      description: "Share Pryva wallet credit", tag: "Wallet credit", artwork: { kind: "service", name: "gift-cards" },
      source: "catalog", coverage: "not-country-specific", stock: null, myUnits: null, price: null,
      action: { label: "View gift cards", href: "/dashboard/gift-cards" },
    },
    {
      id: "bulk-orders", category: "tools", name: "Bulk orders",
      description: "Group catalog plans into one order", tag: "Order tool", artwork: { kind: "service", name: "bulk" },
      source: "tool", coverage: "not-country-specific", stock: null, myUnits: null, price: null,
      action: { label: "Open bulk orders", href: "/dashboard/bulk-orders" },
    },
    {
      id: "scheduled-orders", category: "tools", name: "Scheduled orders",
      description: "Manage recurring preview orders", tag: "Order tool", artwork: { kind: "service", name: "scheduled" },
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
