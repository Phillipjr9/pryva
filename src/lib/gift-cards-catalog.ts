import type { BrandSlug } from "@/lib/brand-marks";
import type { WordmarkSlug } from "@/components/BrandIcon";

export type GiftCardCategory = "gaming" | "apps" | "entertainment" | "retail";

export interface GiftCardDenomination {
  id: string;
  amountUsd: number;
  priceNgn: number;
  popular?: boolean;
  foxreloadProductId?: string;
}

export interface BrandGiftCardCatalogEntry {
  slug: string;
  name: string;
  brand: BrandSlug | WordmarkSlug;
  category: GiftCardCategory;
  tagline: string;
  region: string;
  popular?: boolean;
  redemptionGuide: string;
  denominations: GiftCardDenomination[];
}

export const BRAND_GIFT_CARDS: BrandGiftCardCatalogEntry[] = [
  {
    slug: "steam",
    name: "Steam Wallet Card",
    brand: "steam",
    category: "gaming",
    tagline: "Instant Steam funds for games, DLCs, and community items.",
    region: "Global & US",
    popular: true,
    redemptionGuide: "Open Steam → Profile → View Wallet → Redeem a Steam Gift Card or Wallet Code.",
    denominations: [
      { id: "steam-usd-5", amountUsd: 5, priceNgn: 8500 },
      { id: "steam-usd-10", amountUsd: 10, priceNgn: 16500, popular: true },
      { id: "steam-usd-20", amountUsd: 20, priceNgn: 32500 },
      { id: "steam-usd-50", amountUsd: 50, priceNgn: 80000 },
      { id: "steam-usd-100", amountUsd: 100, priceNgn: 159000 },
    ],
  },
  {
    slug: "apple",
    name: "Apple Gift Card",
    brand: "apple",
    category: "apps",
    tagline: "For App Store apps, games, iCloud, subscriptions, and iTunes.",
    region: "US & Global",
    popular: true,
    redemptionGuide: "Open App Store → Tap your account avatar → Redeem Gift Card or Code.",
    denominations: [
      { id: "apple-usd-10", amountUsd: 10, priceNgn: 16500 },
      { id: "apple-usd-25", amountUsd: 25, priceNgn: 40500, popular: true },
      { id: "apple-usd-50", amountUsd: 50, priceNgn: 80000 },
      { id: "apple-usd-100", amountUsd: 100, priceNgn: 159000 },
    ],
  },
  {
    slug: "google",
    name: "Google Play Gift Card",
    brand: "google",
    category: "apps",
    tagline: "Play Store credits for apps, books, in-app purchases, and subscriptions.",
    region: "US & Global",
    popular: true,
    redemptionGuide: "Open Google Play Store → Profile → Payments & Subscriptions → Redeem gift code.",
    denominations: [
      { id: "google-usd-10", amountUsd: 10, priceNgn: 16500 },
      { id: "google-usd-25", amountUsd: 25, priceNgn: 40500, popular: true },
      { id: "google-usd-50", amountUsd: 50, priceNgn: 80000 },
      { id: "google-usd-100", amountUsd: 100, priceNgn: 159000 },
    ],
  },
  {
    slug: "playstation",
    name: "PlayStation Store Card",
    brand: "playstation",
    category: "gaming",
    tagline: "PSN wallet funds for PlayStation 4, 5 games and PS Plus passes.",
    region: "US",
    popular: true,
    redemptionGuide: "PlayStation Store → Avatar → Redeem Code → Enter 12-digit voucher.",
    denominations: [
      { id: "playstation-usd-10", amountUsd: 10, priceNgn: 16500 },
      { id: "playstation-usd-25", amountUsd: 25, priceNgn: 40500, popular: true },
      { id: "playstation-usd-50", amountUsd: 50, priceNgn: 80000 },
      { id: "playstation-usd-100", amountUsd: 100, priceNgn: 159000 },
    ],
  },
  {
    slug: "xbox",
    name: "Xbox & Microsoft Card",
    brand: "xbox",
    category: "gaming",
    tagline: "Credits for Xbox consoles, Windows games, and Game Pass.",
    region: "US & Global",
    redemptionGuide: "microsoft.com/redeem or Xbox Store → Use a code → Enter 25-digit code.",
    denominations: [
      { id: "xbox-usd-10", amountUsd: 10, priceNgn: 16500 },
      { id: "xbox-usd-25", amountUsd: 25, priceNgn: 40500, popular: true },
      { id: "xbox-usd-50", amountUsd: 50, priceNgn: 80000 },
    ],
  },
  {
    slug: "roblox",
    name: "Roblox Gift Card",
    brand: "roblox",
    category: "gaming",
    tagline: "Robux and Premium subscription credits for avatar items and game passes.",
    region: "Global",
    popular: true,
    redemptionGuide: "Visit roblox.com/redeem → Log in → Enter PIN code → Click Redeem.",
    denominations: [
      { id: "roblox-usd-10", amountUsd: 10, priceNgn: 16500, popular: true },
      { id: "roblox-usd-25", amountUsd: 25, priceNgn: 40500 },
    ],
  },
  {
    slug: "amazon",
    name: "Amazon Gift Card",
    brand: "amazon",
    category: "retail",
    tagline: "Shop millions of items, digital goods, and books on Amazon.",
    region: "US",
    redemptionGuide: "amazon.com/redeem → Sign in → Enter claim code → Apply to balance.",
    denominations: [
      { id: "amazon-usd-10", amountUsd: 10, priceNgn: 16500 },
      { id: "amazon-usd-25", amountUsd: 25, priceNgn: 40500, popular: true },
      { id: "amazon-usd-50", amountUsd: 50, priceNgn: 80000 },
      { id: "amazon-usd-100", amountUsd: 100, priceNgn: 159000 },
    ],
  },
  {
    slug: "razer",
    name: "Razer Gold Card",
    brand: "razer",
    category: "gaming",
    tagline: "Unified virtual credits for 42,000+ gaming and entertainment titles.",
    region: "Global",
    redemptionGuide: "gold.razer.com → Reload Now → Razer Gold PIN → Enter code.",
    denominations: [
      { id: "razer-usd-10", amountUsd: 10, priceNgn: 16500, popular: true },
      { id: "razer-usd-25", amountUsd: 25, priceNgn: 40500 },
      { id: "razer-usd-50", amountUsd: 50, priceNgn: 80000 },
    ],
  },
];

export function getBrandGiftCards(): BrandGiftCardCatalogEntry[] {
  return BRAND_GIFT_CARDS;
}

export function findBrandGiftCard(slug: string): BrandGiftCardCatalogEntry | undefined {
  return BRAND_GIFT_CARDS.find((card) => card.slug === slug);
}

export function findGiftCardDenomination(denominationId: string): {
  card: BrandGiftCardCatalogEntry;
  denomination: GiftCardDenomination;
} | undefined {
  for (const card of BRAND_GIFT_CARDS) {
    const denomination = card.denominations.find((d) => d.id === denominationId);
    if (denomination) return { card, denomination };
  }
  return undefined;
}
