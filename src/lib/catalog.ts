export type ServiceSlug = "numbers" | "esim" | "proxies" | "email-otp" | "data" | "gift-cards" | "bulk" | "scheduled";

export type ServiceKey = ServiceSlug;

export type ProviderMeta = {
  /** Fleexa app/service to fulfil against, e.g. "whatsapp" */
  app?: string;
  /** Fleexa country code, e.g. "us" | "uk" | "ca" */
  country?: string;
  /** Preferred Fleexa email product id/name */
  emailProduct?: string;
  /** Rental months for Fleexa rentals */
  months?: number;
};

export type Plan = {
  slug: string;
  service: ServiceSlug;
  name: string;
  planLabel: string;
  region: string;
  flag?: string;
  duration: string;
  price: number;
  compareAt?: number;
  popular?: boolean;
  badge?: string;
  highlight?: string;
  features: string[];
  provider?: ProviderMeta;
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
  icon: "phone" | "sim" | "globe" | "mail" | "gift" | "package" | "calendar";
  highlights: { title: string; body: string }[];
  included: string[];
  goodFor: string[];
  faqs: { q: string; a: string }[];
};

export const NGN = "₦";

export function formatNaira(value: number): string {
  return `${NGN}${new Intl.NumberFormat("en-NG").format(value)}`;
}

export const services: Service[] = [
  {
    slug: "numbers",
    name: "Virtual Numbers",
    shortName: "Numbers",
    href: "/virtual-numbers",
    eyebrow: "OTP verification",
    tagline: "Real numbers for the codes you need.",
    description:
      "Buy a number for a single verification, or rent one for the long term. Non-VoIP lines across 40+ countries, delivered in seconds.",
    intro:
      "Every line is a real carrier number — never VoIP — so codes from WhatsApp, Telegram, Google, Binance, Tinder, PayPal and 500+ platforms land without friction. Pay in Naira, receive the number instantly, and get an automatic refund if a code never arrives.",
    fromPrice: 1200,
    unit: "per verification",
    icon: "phone",
    highlights: [
      {
        title: "Buy once or rent",
        body: "One-time verification from ₦1,200, or keep the same number for 7, 30 or 90 days.",
      },
      {
        title: "Non-VoIP lines",
        body: "Sourced through Fleexa's carrier network, so verification codes actually arrive.",
      },
      {
        title: "Auto-refund built in",
        body: "If no code lands within the delivery window, the amount returns to your wallet automatically.",
      },
    ],
    included: [
      "Instant number delivery after payment",
      "Live OTP visible in your Pryva dashboard",
      "Refund prompt if the code doesn't arrive",
      "Reusable history for every verification",
    ],
    goodFor: ["WhatsApp", "Telegram", "Google", "Binance", "Tinder", "PayPal", "TikTok", "Discord"],
    faqs: [
      {
        q: "Will the number work for WhatsApp and Telegram?",
        a: "Yes. Our non-VoIP Nigerian, US, UK and EU numbers work for WhatsApp, Telegram, Google and most major platforms. A small number of platforms block shared numbers — in that case you get an instant refund.",
      },
      {
        q: "What is the difference between buying and renting?",
        a: "Buying covers one verification window, typically 20 minutes of code delivery. Renting keeps the number active for 7 to 90 days so you can receive multiple codes and keep the same identity.",
      },
    ],
  },
  {
    slug: "esim",
    name: "eSIM",
    shortName: "eSIM",
    href: "/esim",
    eyebrow: "Travel data",
    tagline: "Land connected. Leave roaming behind.",
    description:
      "Scan once and get data in 190+ destinations. Perfect for travel, remote work and any phone that supports eSIM.",
    intro:
      "Skip the airport SIM queue. Buy a Pryva eSIM in Naira, scan the QR code in your dashboard, and your data plan installs instantly. Works on iPhone XS and newer, most modern Samsung, Pixel and iPad models — no physical SIM swap.",
    fromPrice: 4500,
    unit: "per data bundle",
    icon: "sim",
    highlights: [
      {
        title: "Install in under a minute",
        body: "QR code and manual activation details appear in your dashboard right after checkout.",
      },
      {
        title: "Naira pricing, no card needed",
        body: "Fund your wallet by transfer, then choose any bundle without a dollar card.",
      },
      {
        title: "Regional or country plans",
        body: "Single-country bundles for short trips, or regional passes for multi-city travel.",
      },
    ],
    included: [
      "Digital QR + manual activation codes",
      "Data-only plans with no hidden roaming fees",
      "Coverage in 190+ destinations",
      "Top-up any time from your dashboard",
    ],
    goodFor: ["Travellers", "Remote teams", "Students abroad", "Digital nomads", "Creators"],
    faqs: [
      {
        q: "Does my phone support eSIM?",
        a: "Most phones released from 2020 onward do. On iPhone, check Settings → Cellular → Add eSIM. On Android, look for “Add eSIM” in network settings. If your device doesn't support eSIM, contact support before purchase.",
      },
      {
        q: "Can I keep my WhatsApp number?",
        a: "Yes. Pryva eSIMs are data-only, so they run alongside your existing SIM. Keep your WhatsApp and bank alerts on your primary line and use the eSIM for data abroad.",
      },
    ],
  },
  {
    slug: "proxies",
    name: "Residential Proxies",
    shortName: "Proxies",
    href: "/proxies",
    eyebrow: "Stable residential IPs",
    tagline: "Residential IPs that feel local.",
    description:
      "Ethically sourced residential proxy bandwidth with Nigerian, US, UK and EU exits. Built for sneaker drops, ads verification and research.",
    intro:
      "Pryva's residential proxy network routes through real consumer devices, so your traffic looks like any other local connection. Rotate per request or hold a sticky session for up to 30 minutes, with authentication ready in your dashboard the moment you buy.",
    fromPrice: 3500,
    unit: "per GB",
    icon: "globe",
    highlights: [
      {
        title: "Nigeria-first pool",
        body: "Local mobile and residential exits for testing Nigerian ads, prices and apps.",
      },
      {
        title: "Sticky or rotating",
        body: "Choose rotating per-request IPs or sticky sessions that stay put for up to 30 minutes.",
      },
      {
        title: "Traffic you can track",
        body: "See remaining bandwidth, usage and endpoint credentials in your dashboard.",
      },
    ],
    included: [
      "HTTP/SOCKS5 endpoint credentials",
      "Dashboard usage meter",
      "Sticky sessions up to 30 minutes",
      "City-level targeting on request",
    ],
    goodFor: ["Ad verification", "Sneaker & ticketing", "Market research", "Web scraping", "Ad tech"],
    faqs: [
      {
        q: "Do proxy credits expire?",
        a: "Bandwidth stays in your account for 30 days from purchase. Buy the smallest pack first if you are testing a new workflow, then scale up.",
      },
      {
        q: "Can I use one endpoint for automation?",
        a: "Yes. Every pack gives you a single authentication pair that works with HTTP/SOCKS5, sticky session headers and rotating mode, so it drops straight into your scraping or antidetect stack.",
      },
    ],
  },
  {
    slug: "email-otp",
    name: "Email OTP",
    shortName: "Email OTP",
    href: "/email-otp",
    eyebrow: "Temporary inboxes",
    tagline: "A clean inbox for every signup.",
    description:
      "Disposable email addresses that receive verification mail in real time. Protect your primary inbox from noise and spam.",
    intro:
      "Spin up a temporary address, paste it into any signup form, and watch verification mail arrive in your Pryva dashboard. No forwarding, no app, no inbox clutter. Choose a 24-hour inbox for a quick trial or keep a dedicated address for 30 days.",
    fromPrice: 700,
    unit: "per inbox",
    icon: "mail",
    highlights: [
      {
        title: "Live message view",
        body: "Verification emails and codes appear in your dashboard as soon as they land.",
      },
      {
        title: "No forwarding risk",
        body: "Addresses are isolated to your account, never shared with other customers.",
      },
      {
        title: "Works with any platform",
        body: "Use it for trials, newsletters, testing and staging environments.",
      },
    ],
    included: [
      "Instant inbox creation with any label",
      "Live OTP and full email preview",
      "24-hour or 30-day retention",
      "Unlimited signups on most bundles",
    ],
    goodFor: ["Free trials", "Testing", "Newsletters", "Marketplace signups", "QA teams"],
    faqs: [
      {
        q: "Can I receive email after the inbox expires?",
        a: "No. Once the retention window ends, the address stops accepting mail. Choose the 30-day plan if you need long-term signup verification.",
      },
      {
        q: "Is this a catch-all domain?",
        a: "Each inbox gets a unique Pryva address on a dedicated domain. You can create multiple inboxes and label them per project.",
      },
    ],
  },
  {
    slug: "data",
    name: "Data Plans",
    shortName: "Data",
    href: "/dashboard/data",
    eyebrow: "Airtime & data",
    tagline: "Buy data for any Nigerian network.",
    description:
      "Purchase MTN, Airtel, Glo and 9mobile data plans instantly. Pay with your wallet, get data delivered to any Nigerian number in seconds.",
    intro:
      "Skip the bank app and buy data directly from your Pryva wallet. Choose from 500MB to 10GB bundles across all major Nigerian networks, delivered instantly to any phone number.",
    fromPrice: 500,
    unit: "per plan",
    icon: "phone",
    highlights: [
      {
        title: "All networks",
        body: "MTN, Airtel, Glo and 9mobile data plans available.",
      },
      {
        title: "Instant delivery",
        body: "Data arrives on the target number within seconds of purchase.",
      },
      {
        title: "Pay with wallet",
        body: "Use your existing Pryva wallet balance, no card needed.",
      },
    ],
    included: [
      "Data delivered to any Nigerian number",
      "All major networks supported",
      "Instant delivery after payment",
      "Purchase history in your dashboard",
    ],
    goodFor: ["Personal use", "Family", "Team members", "Quick top-ups"],
    faqs: [
      {
        q: "How long does delivery take?",
        a: "Data is delivered instantly after payment. The recipient will receive a confirmation SMS from their network.",
      },
      {
        q: "Can I buy data for someone else?",
        a: "Yes. Enter any Nigerian phone number during checkout and the data will be delivered to that number.",
      },
    ],
  },
  {
    slug: "gift-cards",
    name: "Gift Cards",
    shortName: "Gift Cards",
    href: "/dashboard/gift-cards",
    eyebrow: "Send value",
    tagline: "Send Pryva credit to anyone.",
    description:
      "Create gift cards from ₦1,000 to ₦500,000. Share the code with friends, family or team members. They redeem it into their Pryva wallet instantly.",
    intro:
      "Send Pryva wallet credit to anyone with a simple code. Purchase a gift card, share the code via email or message, and the recipient redeems it into their wallet with one click. Perfect for birthdays, rewards or team allowances.",
    fromPrice: 1000,
    unit: "per card",
    icon: "gift",
    highlights: [
      {
        title: "Any amount",
        body: "Create gift cards from ₦1,000 to ₦500,000.",
      },
      {
        title: "Instant redemption",
        body: "Recipients enter the code and the credit appears in their wallet immediately.",
      },
      {
        title: "Valid for 1 year",
        body: "Gift cards stay active for 12 months from purchase.",
      },
    ],
    included: [
      "Unique gift card code",
      "Optional recipient email and message",
      "1 year validity",
      "Purchase history in your dashboard",
    ],
    goodFor: ["Birthdays", "Team rewards", "Allowances", "Thank you gifts"],
    faqs: [
      {
        q: "Can I cancel or refund a gift card?",
        a: "No. Gift cards are non-refundable once purchased. Make sure the amount and recipient details are correct before confirming.",
      },
      {
        q: "Can I redeem my own gift card?",
        a: "No. You can only redeem gift cards purchased by other users. This prevents circular transactions.",
      },
    ],
  },
  {
    slug: "bulk",
    name: "Bulk Orders",
    shortName: "Bulk",
    href: "/dashboard/bulk-orders",
    eyebrow: "Buy in bulk",
    tagline: "Discounted multi-buy orders.",
    description:
      "Order 10+ items and save 5%, or 20+ items and save 10%. Perfect for teams, resellers and agencies running multiple accounts.",
    intro:
      "Need multiple virtual numbers, eSIMs or proxy packs? Buy them all at once and unlock automatic discounts. 10+ items gets you 5% off, 20+ items gets you 10% off. All items delivered instantly to your dashboard.",
    fromPrice: 12000,
    unit: "per order",
    icon: "package",
    highlights: [
      {
        title: "Automatic discounts",
        body: "5% off for 10+ items, 10% off for 20+ items.",
      },
      {
        title: "Mix and match",
        body: "Combine any services: numbers, eSIMs, proxies, email OTP.",
      },
      {
        title: "Instant delivery",
        body: "All items appear in your dashboard immediately after purchase.",
      },
    ],
    included: [
      "Automatic quantity discounts",
      "Mix any services in one order",
      "All items delivered instantly",
      "Unified order history",
    ],
    goodFor: ["Teams", "Resellers", "Agencies", "QA departments"],
    faqs: [
      {
        q: "How do discounts work?",
        a: "Add 10 or more items to your cart and 5% is automatically deducted. Add 20 or more items and the discount increases to 10%.",
      },
      {
        q: "Can I mix different services?",
        a: "Yes. You can combine virtual numbers, eSIMs, proxies and email OTP in a single bulk order.",
      },
    ],
  },
  {
    slug: "scheduled",
    name: "Scheduled Purchases",
    shortName: "Scheduled",
    href: "/dashboard/scheduled",
    eyebrow: "Auto-recurring",
    tagline: "Set it and forget it.",
    description:
      "Schedule automatic purchases of any service on a daily, weekly, biweekly or monthly basis. Pause or cancel anytime.",
    intro:
      "Need a fresh virtual number every week? A monthly eSIM top-up? Schedule any Pryva service to purchase automatically on your preferred frequency. The cost is deducted from your wallet each time. Pause, resume or cancel whenever you need.",
    fromPrice: 1200,
    unit: "per schedule",
    icon: "calendar",
    highlights: [
      {
        title: "Flexible frequency",
        body: "Daily, weekly, biweekly or monthly schedules.",
      },
      {
        title: "Full control",
        body: "Pause, resume or cancel any scheduled order at any time.",
      },
      {
        title: "Wallet deduction",
        body: "Cost is automatically deducted from your wallet on each run.",
      },
    ],
    included: [
      "Automatic recurring purchases",
      "Pause/resume/cancel anytime",
      "Email notifications before each run",
      "Full purchase history",
    ],
    goodFor: ["Regular verifications", "Monthly travel", "Ongoing research", "Team accounts"],
    faqs: [
      {
        q: "What happens if my wallet is empty?",
        a: "The scheduled purchase will be skipped if your wallet balance is insufficient. You'll receive a notification to top up.",
      },
      {
        q: "Can I change the frequency?",
        a: "Yes. Cancel the existing schedule and create a new one with your preferred frequency.",
      },
    ],
  },
];

export const serviceMap: Record<ServiceSlug, Service> = services.reduce(
  (acc, service) => ({ ...acc, [service.slug]: service }),
  {} as Record<ServiceSlug, Service>,
);

export const plans: Plan[] = [
  // Virtual numbers — one-time verification
  {
    slug: "vn-ng", service: "numbers", name: "Nigeria", planLabel: "Nigeria number",
    region: "Nigeria", flag: "🇳🇬", duration: "Single verification · 20 min window", price: 1200,
    popular: true, badge: "Most popular", highlight: "Best for WhatsApp, Telegram & local apps",
    features: ["Real non-VoIP line", "Instant delivery", "Auto-refund if no code"],provider: {app: "whatsapp", country: "us"}
  },
  {
    slug: "vn-us", service: "numbers", name: "United States", planLabel: "US number",
    region: "United States", flag: "🇺🇸", duration: "Single verification · 20 min window", price: 1500,
    features: ["Non-VoIP carrier line", "Instant delivery", "Auto-refund if no code"],provider: {app: "whatsapp", country: "us"}
  },
  {
    slug: "vn-uk", service: "numbers", name: "United Kingdom", planLabel: "UK number",
    region: "United Kingdom", flag: "🇬🇧", duration: "Single verification · 20 min window", price: 1800,
    features: ["Non-VoIP carrier line", "Instant delivery", "Auto-refund if no code"],provider: {app: "whatsapp", country: "uk"}
  },
  {
    slug: "vn-ca", service: "numbers", name: "Canada", planLabel: "Canada number",
    region: "Canada", flag: "🇨🇦", duration: "Single verification · 20 min window", price: 2000,
    features: ["Non-VoIP carrier line", "Instant delivery", "Auto-refund if no code"],provider: {app: "whatsapp", country: "ca"}
  },
  {
    slug: "vn-de", service: "numbers", name: "Germany", planLabel: "Germany number",
    region: "Germany", flag: "🇩🇪", duration: "Single verification · 20 min window", price: 2200,
    features: ["Non-VoIP carrier line", "Instant delivery", "Auto-refund if no code"],provider: {app: "google", country: "uk"}
  },
  {
    slug: "vn-gh", service: "numbers", name: "Ghana", planLabel: "Ghana number",
    region: "Ghana", flag: "🇬🇭", duration: "Single verification · 20 min window", price: 1400,
    features: ["Non-VoIP carrier line", "Instant delivery", "Auto-refund if no code"],provider: {app: "telegram", country: "us"}
  },
  {
    slug: "vn-otp-5", service: "numbers", name: "Verification pack", planLabel: "5 verifications",
    region: "Any 5 countries", flag: "🎟️", duration: "5 codes · valid 7 days", price: 5500,
    compareAt: 7000, badge: "Save 20%", highlight: "Buy a bundle of codes for launch week",
    features: ["5 verification windows", "Mix any country", "7 days to use them"],provider: {app: "whatsapp", country: "us"}
  },
  // Virtual numbers — rentals
  {
    slug: "rent-ng-7", service: "numbers", name: "Nigeria rental", planLabel: "NG · 7 days",
    region: "Nigeria", flag: "🇳🇬", duration: "Rent for 7 days", price: 3800, badge: "Rent",
    highlight: "Keep the line for a full week",
    features: ["Reusable for many codes", "Incoming SMS all week", "Renew any time"],provider: {country: "us", months: 1}
  },
  {
    slug: "rent-ng-30", service: "numbers", name: "Nigeria rental", planLabel: "NG · 30 days",
    region: "Nigeria", flag: "🇳🇬", duration: "Rent for 30 days", price: 7500, popular: true,
    badge: "Best value", highlight: "Monthly identity for business accounts",
    features: ["Reusable for many codes", "Incoming SMS all month", "Priority replacement"],provider: {country: "us", months: 1}
  },
  {
    slug: "rent-us-30", service: "numbers", name: "US rental", planLabel: "US · 30 days",
    region: "United States", flag: "🇺🇸", duration: "Rent for 30 days", price: 9500,
    features: ["Reusable for many codes", "Incoming SMS all month", "Priority replacement"],provider: {country: "us", months: 1}
  },
  {
    slug: "rent-uk-30", service: "numbers", name: "UK rental", planLabel: "UK · 30 days",
    region: "United Kingdom", flag: "🇬🇧", duration: "Rent for 30 days", price: 10500,
    features: ["Reusable for many codes", "Incoming SMS all month", "Priority replacement"],provider: {country: "uk", months: 1}
  },
  {
    slug: "rent-ng-90", service: "numbers", name: "Nigeria rental", planLabel: "NG · 90 days",
    region: "Nigeria", flag: "🇳🇬", duration: "Rent for 90 days", price: 19500,
    compareAt: 22500, badge: "Save 13%",
    features: ["Reusable for many codes", "Quarterly business line", "Priority replacement"],provider: {country: "us", months: 3}
  },
  // eSIM
  {
    slug: "esim-ng-1", service: "esim", name: "Nigeria Lite", planLabel: "1GB · 7 days",
    region: "Nigeria", flag: "🇳🇬", duration: "Valid 7 days", price: 4500,
    highlight: "Quick local data when you land in Lagos",
    features: ["1GB high-speed data", "QR + manual activation", "Data-only"],
  },
  {
    slug: "esim-ng-5", service: "esim", name: "Nigeria Plus", planLabel: "5GB · 30 days",
    region: "Nigeria", flag: "🇳🇬", duration: "Valid 30 days", price: 14500, popular: true,
    features: ["5GB high-speed data", "QR + manual activation", "Data-only"],
  },
  {
    slug: "esim-africa", service: "esim", name: "Africa Regional", planLabel: "3GB · 15 days",
    region: "Africa (12 countries)", flag: "🌍", duration: "Valid 15 days", price: 12000,
    badge: "Regional", highlight: "One plan across 12 African countries",
    features: ["3GB across the region", "Covers 12 countries", "QR + manual activation"],
  },
  {
    slug: "esim-europe", service: "esim", name: "Europe Regional", planLabel: "5GB · 30 days",
    region: "Europe (38 countries)", flag: "🇪🇺", duration: "Valid 30 days", price: 18500,
    features: ["5GB across 38 countries", "Keep your WhatsApp", "QR + manual activation"],
  },
  {
    slug: "esim-us", service: "esim", name: "United States", planLabel: "10GB · 30 days",
    region: "United States", flag: "🇺🇸", duration: "Valid 30 days", price: 24000,
    badge: "Heavy use", features: ["10GB high-speed data", "Works on 5G", "QR + manual activation"],
  },
  {
    slug: "esim-global", service: "esim", name: "Global", planLabel: "20GB · 30 days",
    region: "Global (120+ countries)", flag: "🌐", duration: "Valid 30 days", price: 48000,
    features: ["20GB across the world", "120+ destinations", "QR + manual activation"],
  },
  // Proxies
  {
    slug: "proxy-ng-1", service: "proxies", name: "Nigeria Starter", planLabel: "1GB · Nigeria",
    region: "Nigeria", flag: "🇳🇬", duration: "7 days to use", price: 3500,
    highlight: "Test the Nigerian pool before scaling",
    features: ["1GB residential traffic", "HTTP/SOCKS5", "Rotating or sticky"],
  },
  {
    slug: "proxy-ng-5", service: "proxies", name: "Nigeria Growth", planLabel: "5GB · Nigeria",
    region: "Nigeria", flag: "🇳🇬", duration: "30 days to use", price: 15000, popular: true,
    compareAt: 17500, badge: "Best value",
    features: ["5GB residential traffic", "City-level targeting", "HTTP/SOCKS5"],
  },
  {
    slug: "proxy-us-5", service: "proxies", name: "United States", planLabel: "5GB · US",
    region: "United States", flag: "🇺🇸", duration: "30 days to use", price: 17500,
    features: ["5GB US residential traffic", "Sticky sessions", "HTTP/SOCKS5"],
  },
  {
    slug: "proxy-eu-10", service: "proxies", name: "Europe", planLabel: "10GB · EU",
    region: "Europe", flag: "🇪🇺", duration: "30 days to use", price: 32000,
    features: ["10GB EU residential traffic", "City + country targeting", "HTTP/SOCKS5"],
  },
  {
    slug: "proxy-ng-25", service: "proxies", name: "Nigeria Scale", planLabel: "25GB · Nigeria",
    region: "Nigeria", flag: "🇳🇬", duration: "30 days to use", price: 65000,
    badge: "Scale", features: ["25GB residential traffic", "Priority pool", "HTTP/SOCKS5"],
  },
  // Email OTP
  {
    slug: "email-24", service: "email-otp", name: "Quick inbox", planLabel: "1 inbox · 24 hours",
    region: "Any domain", flag: "✉️", duration: "Expires after 24 hours", price: 700,
    popular: true, highlight: "Ideal for a single signup or trial",
    features: ["Unique address instantly", "Live OTP view", "No forwarding"],provider: {emailProduct: "auto"}
  },
  {
    slug: "email-30", service: "email-otp", name: "Long inbox", planLabel: "1 inbox · 30 days",
    region: "Any domain", flag: "✉️", duration: "Active for 30 days", price: 5500,
    features: ["Keep the same address", "Unlimited signups", "Live OTP view"],provider: {emailProduct: "auto"}
  },
  {
    slug: "email-bundle", service: "email-otp", name: "Inbox bundle", planLabel: "5 inboxes · 7 days",
    region: "Any domain", flag: "📬", duration: "Active for 7 days", price: 1800,
    compareAt: 3500, badge: "Save 48%",
    features: ["5 isolated inboxes", "Label by project", "Live OTP view"],provider: {emailProduct: "auto"}
  },
  {
    slug: "email-team", service: "email-otp", name: "Team bundle", planLabel: "20 inboxes · 30 days",
    region: "Any domain", flag: "📬", duration: "Active for 30 days", price: 12500,
    badge: "For QA teams", features: ["20 isolated inboxes", "Shared team access", "Live OTP view"],provider: {emailProduct: "auto"}
  },
];

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
