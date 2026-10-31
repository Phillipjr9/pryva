import { CATALOG_PRICES } from "@/lib/prices.generated";
import { missingPriceError } from "@/lib/pricing-diagnostics";

export type ServiceSlug =
  | "numbers"
  | "esim"
  | "proxies"
  | "email-otp"
  | "accounts"
  | "data"
  | "gift-cards"
  | "bulk"
  | "scheduled";

export type ServiceKey = ServiceSlug;

export type Plan = {
  slug: string;
  service: ServiceSlug;
  name: string;
  planLabel: string;
  region: string;
  flag?: string;
  duration: string;
  /** Generated from the supplier cost sheet — see scripts/build-prices.mjs. */
  price: number;
  compareAt?: number;
  popular?: boolean;
  badge?: string;
  highlight?: string;
  features: string[];
};

export type Service = {
  slug: ServiceSlug;
  name: string;
  shortName: string;
  href: string;
  eyebrow: string;
  tagline: string;
  description: string;
  intro: string;
  /**
   * The cheapest way to buy into this service — or absent, when the service is
   * not something a customer buys at all.
   *
   * This is optional on purpose. `services` below derives it from real plan
   * prices, but falls back to whatever the definition hand-set when a service
   * has no plans. That fallback is how a price survives the deletion of the
   * thing it priced: removing every plan from a paid service would leave its
   * hand-set `fromPrice` rendering on the homepage as though nothing changed.
   * A free service therefore has no value here, and every consumer must decide
   * what to render instead of being handed a number it can display blindly.
   */
  fromPrice?: number;
  unit: string;
  icon: "phone" | "sim" | "globe" | "mail" | "accounts" | "gift" | "package" | "calendar";
  highlights: { title: string; body: string }[];
  included: string[];
  goodFor: string[];
  faqs: { q: string; a: string }[];
};

export const NGN = "₦";

export function formatNaira(value: number): string {
  return `${NGN}${new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 }).format(value)}`;
}

const serviceDefinitions: Service[] = [
  {
    slug: "numbers", name: "Virtual Numbers", shortName: "Numbers", href: "/virtual-numbers",
    eyebrow: "OTP verification", tagline: "Explore virtual number plans.",
    description: "Browse single-verification and rental number plans, delivered automatically to your dashboard.",
    intro: "Explore number plans priced in Naira. Orders are fulfilled automatically and your verification code appears in the order details.",
    fromPrice: 1340, unit: "per verification", icon: "phone",
    highlights: [
      { title: "Plan types", body: "The catalog lists single-verification and rental plans for comparison." },
      { title: "Compatibility varies", body: "Check the destination platform's rules; number acceptance cannot be guaranteed." },
      { title: "Support", body: "Contact support with your order reference if an existing delivery needs review." },
    ],
    included: ["Catalog prices in Naira", "Automatic delivery", "Support review for existing orders"],
    goodFor: ["Verification guides", "Plan comparison", "Rentals"],
    faqs: [
      { q: "Can I receive real SMS codes?", a: "Yes. A single-verification number receives one code, which appears in your order details as soon as it arrives." },
      { q: "What is the difference between buying and renting?", a: "A single-verification number receives one code. A rental keeps the same number for 30 or 90 days, so you can re-read incoming codes while it is active." },
    ],
  },
  {
    slug: "esim", name: "eSIM", shortName: "eSIM", href: "/esim", eyebrow: "Travel data",
    tagline: "Explore eSIM data plans.",
    description: "Compare catalog eSIM plans by region and data allowance. eSIM plans are not available for purchase yet.",
    intro: "Browse eSIM plans by region and data allowance. eSIM plans cannot be delivered yet, so they cannot be ordered or charged.",
    fromPrice: 4700, unit: "per data bundle", icon: "sim",
    highlights: [
      { title: "Check your device", body: "Confirm eSIM compatibility and carrier unlock requirements with your device and carrier." },
      { title: "Review coverage", body: "Coverage and availability need provider confirmation before a live purchase." },
      { title: "Not available yet", body: "eSIM plans cannot be delivered yet, so nothing here can be ordered or charged." },
    ],
    included: ["Catalog plan comparisons", "Naira pricing", "Coverage research"],
    goodFor: ["Travel planning", "Device compatibility", "Coverage research"],
    faqs: [
      { q: "Does my phone support eSIM?", a: "Compatibility depends on the model, region and carrier. Check your device and carrier documentation." },
      { q: "Can I activate an eSIM now?", a: "No. eSIM plans are not available for purchase yet." },
    ],
  },
  {
    slug: "proxies", name: "Residential Proxies", shortName: "Proxies", href: "/proxies",
    eyebrow: "Proxy plans", tagline: "Explore proxy plans.",
    description: "Compare proxy bandwidth plans by region and duration. Proxy plans are not available for purchase yet.",
    intro: "Browse proxy plan details and pricing. Proxy plans cannot be delivered yet, so they cannot be ordered or charged.",
    fromPrice: 3650, unit: "per GB", icon: "globe",
    highlights: [
      { title: "Plan comparison", body: "Review the region, bandwidth and duration shown in the catalog." },
      { title: "Responsible use", body: "Use any proxy only with authorization and in accordance with applicable terms." },
      { title: "Not available yet", body: "Proxy plans cannot be delivered yet, so nothing here can be ordered or charged." },
    ],
    included: ["Catalog plan comparisons", "Naira pricing", "Bandwidth planning"],
    goodFor: ["Research", "Plan comparison", "Bandwidth planning"],
    faqs: [
      { q: "Can I buy a proxy now?", a: "No. Proxy plans are not available for purchase yet." },
      { q: "Does a proxy guarantee anonymity?", a: "No. A proxy does not by itself guarantee anonymity or access to a particular site." },
    ],
  },
  {
    slug: "email-otp", name: "Email OTP", shortName: "Email OTP", href: "/email-otp",
    eyebrow: "Free temporary inbox", tagline: "A free temporary inbox, one at a time.",
    description: "Create a temporary inbox, read what arrives in it, and discard it when you are done. It is free — there is nothing here to buy.",
    intro: "Temporary inboxes are free and are not a paid plan. Nothing in this category is ordered or charged.",
    unit: "free", icon: "mail",
    highlights: [
      { title: "Free, not a plan", body: "A temporary inbox costs nothing. It is not bought, ordered or charged, so it never appears in pricing." },
      { title: "One at a time", body: "Each account keeps one active inbox. Discard it to create the next one." },
      { title: "Check platform rules", body: "Some services do not accept temporary email addresses. Never use one for an account you need to recover later." },
    ],
    included: ["A temporary address", "A live view of what it receives", "One-tap discard"],
    goodFor: ["A one-off signup", "Keeping your real address private", "Reading a single verification code"],
    faqs: [
      { q: "Does a temporary inbox cost anything?", a: "No. It is free, and nothing here is ordered or charged." },
      { q: "How many inboxes can I have?", a: "One active inbox at a time. Discard it to create another." },
      { q: "Will every platform accept a temporary email?", a: "No. Check the platform's terms and restrictions first, and never use a temporary address for anything you will need to recover later." },
    ],
  },
  {
    slug: "accounts", name: "Digital Accounts", shortName: "Accounts", href: "/accounts",
    eyebrow: "Marketplace", tagline: "Explore account listings.",
    description: "Browse live account listings when available, priced in naira. Orders that cannot be confirmed go to review instead of charging you twice.",
    intro: "Account listings, stock and prices are read live. Availability and credentials are not guaranteed; a purchase that cannot be confirmed is held for review.",
    fromPrice: 800, unit: "per account", icon: "accounts",
    highlights: [
      { title: "Listings", body: "Listings and stock are read live, so what you see is what is available now." },
      { title: "Checkout controls", body: "Every order is priced in naira and debited once, from your wallet or a card top-up." },
      { title: "Order review", body: "Contact support if delivery cannot be confirmed; do not repeat an uncertain purchase." },
    ],
    included: ["Live listings", "Naira pricing", "Support review for uncertain orders"],
    goodFor: ["Listing comparison", "Catalog browsing", "Order support"],
    faqs: [
      { q: "Can I purchase accounts now?", a: "Yes, for any listing shown as available. Items without live stock cannot be ordered." },
      { q: "What if delivery is uncertain?", a: "Keep the reference and contact support before ordering again." },
    ],
  },
  {
    slug: "data", name: "Data Plans", shortName: "Data", href: "/dashboard/data",
    eyebrow: "Data plans", tagline: "Explore data plans.",
    description: "Browse mobile data plans by network, allowance and duration across MTN, Airtel, Glo and 9mobile.",
    intro: "Explore local mobile data plans with instant network delivery.",
    fromPrice: 500, unit: "per plan", icon: "phone",
    highlights: [
      { title: "Plan comparison", body: "Review network, allowance and duration before ordering." },
      { title: "Instant Delivery", body: "Mobile data plans are processed directly for local Nigerian networks." },
      { title: "Support", body: "Contact support about an existing order with its reference." },
    ],
    included: ["Catalog plan comparisons", "Naira pricing", "Allowance comparison"], goodFor: ["Plan comparison", "Allowance comparison", "Order history"],
    faqs: [
      { q: "Which networks are listed?", a: "MTN, Airtel, Glo and 9mobile, with allowance, duration and price shown per plan." },
      { q: "How fast is delivery?", a: "Orders are processed immediately once payment is confirmed." },
    ],
  },
  {
    slug: "bulk", name: "Bulk Orders", shortName: "Bulk", href: "/dashboard/bulk-orders",
    eyebrow: "Bulk baskets", tagline: "Explore multi-item baskets.",
    description: "Order catalog items in volume with automated tiered volume discounts.",
    intro: "Build a bulk basket and review the total and instant discounts applied.",
    fromPrice: 12000, unit: "per order", icon: "package",
    highlights: [
      { title: "Basket pricing", body: "Review each item, its quantity and the final total." },
      { title: "Volume Discounts", body: "Tiered discounts up to 10% applied automatically to your basket." },
      { title: "Automated fulfillment", body: "Items in your bulk order are provisioned and delivered automatically." },
    ],
    included: ["Basket summary", "Calculated discounts", "Volume pricing"], goodFor: ["Basket comparison", "Volume quoting", "Order history"],
    faqs: [
      { q: "How do discounts work?", a: "Discounts apply automatically at 10+ and 20+ items up to 10% off." },
      { q: "Can I buy products in bulk?", a: "Yes, build your basket and checkout directly using your wallet balance." },
    ],
  },
  {
    slug: "scheduled", name: "Scheduled Purchases", shortName: "Scheduled", href: "/dashboard/scheduled",
    eyebrow: "Scheduled orders", tagline: "Explore scheduled orders.",
    description: "Automate recurring purchases on daily, weekly, biweekly, or monthly intervals.",
    intro: "Scheduled purchases automate recurring orders settled directly from your wallet balance.",
    fromPrice: 1200, unit: "per schedule", icon: "calendar",
    highlights: [
      { title: "Flexible Frequency", body: "Schedule settings include daily, weekly, biweekly and monthly options." },
      { title: "Full Control", body: "Review, pause, resume or cancel schedules directly from the dashboard." },
      { title: "Automated Execution", body: "Orders run automatically when due and debit your wallet balance." },
    ],
    included: ["Schedule settings", "Pause and cancel controls", "Order history"],
    goodFor: ["Recurring needs", "Planning", "Order history"],
    faqs: [
      { q: "Can I schedule purchases?", a: "Yes. Set up schedules for any supported catalog plan from your dashboard." },
      { q: "Could I cancel a schedule?", a: "Schedules can be paused, resumed, or cancelled at any time from your dashboard." },
    ],
  },
];


type PlanDefinition = Omit<Plan, "price" | "compareAt"> & { compareAt?: number };

const planDefinitions: PlanDefinition[] = [
  // Virtual numbers — one-time verification
  {
    slug: "vn-ng", service: "numbers", name: "Nigeria", planLabel: "Nigeria number",
    region: "Nigeria", flag: "🇳🇬", duration: "Single verification · 20 min window",
    popular: true, badge: "Most popular", highlight: "Best for WhatsApp, Telegram & local apps",
    features: ["Real non-VoIP line", "Instant delivery", "Support review for delivery issues"]
  },
  {
    slug: "vn-us", service: "numbers", name: "United States", planLabel: "US number",
    region: "United States", flag: "🇺🇸", duration: "Single verification · 20 min window",
    features: ["Non-VoIP carrier line", "Instant delivery", "Support review for delivery issues"]
  },
  {
    slug: "vn-uk", service: "numbers", name: "United Kingdom", planLabel: "UK number",
    region: "United Kingdom", flag: "🇬🇧", duration: "Single verification · 20 min window",
    features: ["Non-VoIP carrier line", "Instant delivery", "Support review for delivery issues"]
  },
  {
    slug: "vn-ca", service: "numbers", name: "Canada", planLabel: "Canada number",
    region: "Canada", flag: "🇨🇦", duration: "Single verification · 20 min window",
    features: ["Non-VoIP carrier line", "Instant delivery", "Support review for delivery issues"]
  },
  {
    slug: "vn-de", service: "numbers", name: "Germany", planLabel: "Germany number",
    region: "Germany", flag: "🇩🇪", duration: "Single verification · 20 min window",
    features: ["Non-VoIP carrier line", "Instant delivery", "Support review for delivery issues"]
  },
  {
    slug: "vn-gh", service: "numbers", name: "Ghana", planLabel: "Ghana number",
    region: "Ghana", flag: "🇬🇭", duration: "Single verification · 20 min window",
    features: ["Non-VoIP carrier line", "Instant delivery", "Support review for delivery issues"]
  },
  {
    slug: "vn-otp-5", service: "numbers", name: "Verification pack", planLabel: "5 verifications",
    region: "Any 5 countries", flag: "🎟️", duration: "5 codes · valid 7 days",
    compareAt: 7000, badge: "Save 20%", highlight: "Buy a bundle of codes for launch week",
    features: ["5 verification windows", "Mix any country", "7 days to use them"]
  },
  // Virtual numbers — rentals
  {
    slug: "rent-ng-7", service: "numbers", name: "Nigeria rental", planLabel: "NG · 7 days",
    region: "Nigeria", flag: "🇳🇬", duration: "Rent for 7 days", badge: "Rent",
    highlight: "Keep the line for a full week",
    features: ["Reusable for many codes", "Incoming SMS all week", "Renew any time"]
  },
  {
    slug: "rent-ng-30", service: "numbers", name: "Nigeria rental", planLabel: "NG · 30 days",
    region: "Nigeria", flag: "🇳🇬", duration: "Rent for 30 days", popular: true,
    badge: "Best value", highlight: "Monthly identity for business accounts",
    features: ["Reusable for many codes", "Incoming SMS all month", "Priority replacement"]
  },
  {
    slug: "rent-us-30", service: "numbers", name: "US rental", planLabel: "US · 30 days",
    region: "United States", flag: "🇺🇸", duration: "Rent for 30 days",
    features: ["Reusable for many codes", "Incoming SMS all month", "Priority replacement"]
  },
  {
    slug: "rent-uk-30", service: "numbers", name: "UK rental", planLabel: "UK · 30 days",
    region: "United Kingdom", flag: "🇬🇧", duration: "Rent for 30 days",
    features: ["Reusable for many codes", "Incoming SMS all month", "Priority replacement"]
  },
  {
    slug: "rent-ng-90", service: "numbers", name: "Nigeria rental", planLabel: "NG · 90 days",
    region: "Nigeria", flag: "🇳🇬", duration: "Rent for 90 days",
    compareAt: 22500, badge: "Save 13%",
    features: ["Reusable for many codes", "Quarterly business line", "Priority replacement"]
  },
  // eSIM
  {
    slug: "esim-ng-1", service: "esim", name: "Nigeria Lite", planLabel: "1GB · 7 days",
    region: "Nigeria", flag: "🇳🇬", duration: "Valid 7 days",
    highlight: "Quick local data when you land in Lagos",
    features: ["1GB high-speed data", "QR + manual activation", "Data-only"],
  },
  {
    slug: "esim-ng-5", service: "esim", name: "Nigeria Plus", planLabel: "5GB · 30 days",
    region: "Nigeria", flag: "🇳🇬", duration: "Valid 30 days", popular: true,
    features: ["5GB high-speed data", "QR + manual activation", "Data-only"],
  },
  {
    slug: "esim-africa", service: "esim", name: "Africa Regional", planLabel: "3GB · 15 days",
    region: "Africa (12 countries)", flag: "🌍", duration: "Valid 15 days",
    badge: "Regional", highlight: "One plan across 12 African countries",
    features: ["3GB across the region", "Covers 12 countries", "QR + manual activation"],
  },
  {
    slug: "esim-europe", service: "esim", name: "Europe Regional", planLabel: "5GB · 30 days",
    region: "Europe (38 countries)", flag: "🇪🇺", duration: "Valid 30 days",
    features: ["5GB across 38 countries", "Keep your WhatsApp", "QR + manual activation"],
  },
  {
    slug: "esim-us", service: "esim", name: "United States", planLabel: "10GB · 30 days",
    region: "United States", flag: "🇺🇸", duration: "Valid 30 days",
    badge: "Heavy use", features: ["10GB high-speed data", "Works on 5G", "QR + manual activation"],
  },
  {
    slug: "esim-global", service: "esim", name: "Global", planLabel: "20GB · 30 days",
    region: "Global (120+ countries)", flag: "🌐", duration: "Valid 30 days",
    features: ["20GB across the world", "120+ destinations", "QR + manual activation"],
  },
  // Proxies
  {
    slug: "proxy-ng-1", service: "proxies", name: "Nigeria Starter", planLabel: "1GB · Nigeria",
    region: "Nigeria", flag: "🇳🇬", duration: "7 days to use",
    highlight: "Test the Nigerian pool before scaling",
    features: ["1GB residential traffic", "HTTP/SOCKS5", "Rotating or sticky"],
  },
  {
    slug: "proxy-ng-5", service: "proxies", name: "Nigeria Growth", planLabel: "5GB · Nigeria",
    region: "Nigeria", flag: "🇳🇬", duration: "30 days to use", popular: true,
    compareAt: 17500, badge: "Best value",
    features: ["5GB residential traffic", "City-level targeting", "HTTP/SOCKS5"],
  },
  {
    slug: "proxy-us-5", service: "proxies", name: "United States", planLabel: "5GB · US",
    region: "United States", flag: "🇺🇸", duration: "30 days to use",
    features: ["5GB US residential traffic", "Sticky sessions", "HTTP/SOCKS5"],
  },
  {
    slug: "proxy-eu-10", service: "proxies", name: "Europe", planLabel: "10GB · EU",
    region: "Europe", flag: "🇪🇺", duration: "30 days to use",
    features: ["10GB EU residential traffic", "City + country targeting", "HTTP/SOCKS5"],
  },
  {
    slug: "proxy-ng-25", service: "proxies", name: "Nigeria Scale", planLabel: "25GB · Nigeria",
    region: "Nigeria", flag: "🇳🇬", duration: "30 days to use",
    badge: "Scale", features: ["25GB residential traffic", "Priority pool", "HTTP/SOCKS5"],
  },
  // Email OTP has no plans, deliberately.
  //
  // It used to carry four duration tiers (email-24, email-30, email-bundle,
  // email-team). They could never be delivered: the provider's email products
  // expose no duration, so a 24-hour inbox and a 30-day inbox are the same
  // purchase upstream and each tier promised something we could not honour.
  //
  // They are not replaced by another paid tier either. A disposable inbox is a
  // commodity whose effective market price is zero -- free services hand one out
  // in a click -- so charging for one was never going to sell. The inbox is now
  // a free tool attached to an account rather than a product, which is why it
  // has no plan here, no cost-sheet entry, and no price anywhere in the
  // catalogue. See src/lib/disposable-email.ts.
];

/**
 * Selling prices are generated, never typed.
 *
 * `data/cost-sheet.json` holds the fixed amount we pay per plan and
 * `scripts/build-prices.mjs` bakes the result of `priceFromCost()` — 30–50%
 * markup, rounded up to the price step — into `prices.generated.ts`. The costs
 * themselves stay out of this module on purpose: it is imported by client
 * components, and buying prices must not ship to the browser.
 *
 * Historical strike-through prices and popularity badges are not shown until
 * they can be supported by verified pricing and usage data.
 */
export const plans: Plan[] = planDefinitions.map((definition) => {
  const generated = CATALOG_PRICES[definition.slug];
  if (!generated) {
    throw missingPriceError(`plan "${definition.slug}"`);
  }
  return {
    ...definition,
    price: generated.price,
    // Supplier mappings and historical/popularity claims are not verified, so
    // they are never rendered as fact.
    compareAt: undefined,
    popular: undefined,
    badge: undefined,
    highlight: undefined,
    features: ["Catalog plan details shown above", "Priced in Naira", "Order reference for support"],
  };
});

/**
 * `fromPrice` is a promise to the customer — "you can buy this from ₦X" — so it
 * is computed from real plan prices wherever plans exist. Hand-set values remain
 * only for the services priced elsewhere: accounts (live marketplace listings),
 * data plans and gift cards (sold at face value — see PRICING.md), where a
 * 30–50% markup above face value is not a thing the market allows.
 */
export const services: Service[] = serviceDefinitions.map((service) => {
  const candidates = plans
    .filter((plan) => plan.service === service.slug)
    .map((plan) => plan.price);

  // Bulk and scheduled purchases are ordinary catalogue plans bought in bulk or
  // on a schedule, so their floor is the cheapest catalogue plan.
  if (candidates.length === 0 && (service.slug === "bulk" || service.slug === "scheduled")) {
    candidates.push(...plans.map((plan) => plan.price));
  }

  return candidates.length > 0
    ? { ...service, fromPrice: Math.min(...candidates) }
    : service;
});

export const serviceMap: Record<ServiceSlug, Service> = services.reduce(
  (acc, service) => ({ ...acc, [service.slug]: service }),
  {} as Record<ServiceSlug, Service>,
);

export function plansFor(service: ServiceSlug): Plan[] {
  return plans.filter((plan) => plan.service === service);
}

export function findPlan(slug: string): Plan | undefined {
  return plans.find((plan) => plan.slug === slug);
}

export function findService(slug: string): Service | undefined {
  return services.find((service) => service.slug === slug);
}

export const serviceIcons: Record<ServiceSlug, string> = {
  numbers: "phone",
  esim: "sim",
  proxies: "globe",
  "email-otp": "mail",
  accounts: "accounts",
  data: "phone",
  "gift-cards": "gift",
  bulk: "package",
  scheduled: "calendar",
};

export function orderStatusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Active";
    case "delivered":
      return "Code received";
    case "refunded":
      return "Refunded";
    case "expired":
      return "Expired";
    default:
      return status;
  }
}
