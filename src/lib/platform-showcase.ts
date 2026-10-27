import type { BrandSlug } from "@/lib/brand-marks";

/**
 * The platforms Pryva verifies numbers and sells accounts for — the list behind
 * the scrolling strip on the homepage.
 *
 * Every entry points at a real brand mark (`src/lib/brand-marks.ts`), so the
 * strip can never drift into text-only or placeholder tiles. Keep it in sync
 * with what the marketplace actually stocks.
 */
export type ShowcasePlatform = {
  label: string;
  brand: BrandSlug;
};

export const PLATFORM_SHOWCASE: ShowcasePlatform[] = [
  { label: "WhatsApp", brand: "whatsapp" },
  { label: "Telegram", brand: "telegram" },
  { label: "Google", brand: "google" },
  { label: "Binance", brand: "binance" },
  { label: "TikTok", brand: "tiktok" },
  { label: "Instagram", brand: "instagram" },
  { label: "PayPal", brand: "paypal" },
  { label: "Discord", brand: "discord" },
  { label: "Uber", brand: "uber" },
  { label: "X", brand: "x" },
  { label: "Netflix", brand: "netflix" },
  { label: "Snapchat", brand: "snapchat" },
  { label: "Tinder", brand: "tinder" },
  { label: "OKX", brand: "okx" },
  { label: "Facebook", brand: "facebook" },
  { label: "Spotify", brand: "spotify" },
];
