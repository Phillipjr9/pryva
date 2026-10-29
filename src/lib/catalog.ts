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
  fromPrice: number;
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
    eyebrow: "Temporary inbox plans", tagline: "Explore temporary inbox plans.",
    description: "Browse temporary inbox plans by duration. Email OTP plans are not available for purchase yet.",
    intro: "Compare temporary inbox plans. Email OTP cannot be delivered yet, so it cannot be ordered or charged.",
    fromPrice: 790, unit: "per inbox", icon: "mail",
    highlights: [
      { title: "Compare durations", body: "Review the durations listed in the catalog." },
      { title: "Check platform rules", body: "Some services do not accept temporary email addresses." },
      { title: "Not available yet", body: "Temporary inboxes cannot be delivered yet, so nothing here can be ordered or charged." },
    ],
    included: ["Catalog plan comparisons", "Naira pricing", "Duration comparison"],
    goodFor: ["Testing plans", "Privacy guides", "Duration comparison"],
    faqs: [
      { q: "Can I buy a temporary inbox now?", a: "No. Email OTP plans are not available for purchase yet." },
      { q: "Will every platform accept a temporary email?", a: "No. Check the platform's terms and restrictions." },
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
    description: "Browse mobile data plans by network, allowance and duration. Data plans are not available for purchase yet.",
    intro: "The data catalog is available to explore, but data plans cannot be delivered yet, so they cannot be ordered or charged.",
    fromPrice: 500, unit: "per plan", icon: "phone",
    highlights: [
      { title: "Plan comparison", body: "Review network, allowance and duration before ordering." },
      { title: "Not available yet", body: "Data plans cannot be delivered yet, so nothing here can be ordered or charged." },
      { title: "Support", body: "Contact support about an existing order with its reference." },
    ],
    included: ["Catalog plan comparisons", "Naira pricing", "Allowance comparison"], goodFor: ["Plan comparison", "Allowance comparison", "Order history"],
    faqs: [
      { q: "Can I buy mobile data?", a: "No. Data plans are not available for purchase yet." },
      { q: "Which networks are listed?", a: "MTN, Airtel, Glo and 9mobile, with allowance, duration and price shown per plan." },
    ],
  },
  {
    slug: "gift-cards", name: "Gift Cards", shortName: "Gift Cards", href: "/dashboard/gift-cards",
    eyebrow: "Send value", tagline: "Share wallet credit with a code.",
    description: "Create a gift card from your wallet and share its code with a recipient.",
    intro: "Create a gift card using your wallet and share its code through a trusted channel. Gift cards are non-refundable.",
    fromPrice: 1000, unit: "per card", icon: "gift",
    highlights: [
      { title: "Choose an amount", body: "Gift card values range from ₦1,000 to ₦500,000." },
      { title: "Protect the code", body: "Treat the redemption code like cash and share it only with the intended recipient." },
      { title: "Validity", body: "Cards expire one year after purchase and are non-refundable." },
    ],
    included: ["Unique gift card code", "Optional recipient details", "One-year validity"],
    goodFor: ["Gifts", "Team rewards", "Wallet credit"],
    faqs: [
      { q: "Can I cancel or refund a gift card?", a: "Gift cards are non-refundable once purchased." },
      { q: "Can I redeem my own card?", a: "No. A purchaser cannot redeem their own gift card." },
    ],
  },
  {
    slug: "bulk", name: "Bulk Orders", shortName: "Bulk", href: "/dashboard/bulk-orders",
    eyebrow: "Bulk baskets", tagline: "Explore multi-item baskets.",
    description: "Compare a basket of catalog items and review volume discounts. Bulk purchasing is not available yet.",
    intro: "Build a basket and review the total and any discount displayed. Bulk purchasing cannot be completed yet, so nothing can be ordered or charged.",
    fromPrice: 12000, unit: "per order", icon: "package",
    highlights: [
      { title: "Basket pricing", body: "Review each item, its quantity and the final total." },
      { title: "Discounts", body: "The applied discount depends on the products in the basket." },
      { title: "Not available yet", body: "Bulk purchasing cannot be completed yet, so nothing here can be ordered or charged." },
    ],
    included: ["Basket summary", "Calculated discounts", "Volume pricing"], goodFor: ["Basket comparison", "Volume quoting", "Order history"],
    faqs: [
      { q: "How do discounts work?", a: "The applicable discount depends on basket quantity and product pricing. Review the final total before submitting." },
      { q: "Can I buy products in bulk?", a: "No. Bulk purchasing is not available yet." },
    ],
  },
  {
    slug: "scheduled", name: "Scheduled Purchases", shortName: "Scheduled", href: "/dashboard/scheduled",
    eyebrow: "Scheduled orders", tagline: "Explore scheduled orders.",
    description: "Review scheduled-order settings. Scheduled purchasing is not available yet.",
    intro: "Scheduled purchasing is not available yet, so nothing here can be ordered or charged.",
    fromPrice: 1200, unit: "per schedule", icon: "calendar",
    highlights: [
      { title: "Frequency", body: "Schedule settings include daily, weekly, biweekly and monthly options." },
      { title: "Control", body: "Review, pause or cancel schedules from the dashboard." },
      { title: "Not available yet", body: "Scheduled purchasing cannot be completed yet, so nothing here can be ordered or charged." },
    ],
    included: ["Schedule settings", "Pause and cancel controls", "Order history"],
    goodFor: ["Recurring needs", "Planning", "Order history"],
    faqs: [
      { q: "Can I schedule purchases?", a: "No. Scheduled purchasing is not available yet." },
      { q: "Could I cancel a schedule?", a: "Schedules are designed to be paused or cancelled from the dashboard, once the feature is available." },
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
  // Email OTP
  {
    slug: "email-24", service: "email-otp", name: "Quick inbox", planLabel: "1 inbox · 24 hours",
    region: "Any domain", flag: "✉️", duration: "Expires after 24 hours",
    popular: true, highlight: "Ideal for a single signup or trial",
    features: ["Unique address instantly", "Live OTP view", "No forwarding"]
  },
  {
    slug: "email-30", service: "email-otp", name: "Long inbox", planLabel: "1 inbox · 30 days",
    region: "Any domain", flag: "✉️", duration: "Active for 30 days",
    features: ["Keep the same address", "Unlimited signups", "Live OTP view"]
  },
  {
    slug: "email-bundle", service: "email-otp", name: "Inbox bundle", planLabel: "5 inboxes · 7 days",
    region: "Any domain", flag: "📬", duration: "Active for 7 days",
    compareAt: 3500, badge: "Save 48%",
    features: ["5 isolated inboxes", "Label by project", "Live OTP view"]
  },
  {
    slug: "email-team", service: "email-otp", name: "Team bundle", planLabel: "20 inboxes · 30 days",
    region: "Any domain", flag: "📬", duration: "Active for 30 days",
    badge: "For QA teams", features: ["20 isolated inboxes", "Shared team access", "Live OTP view"]
  },
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
