import type { ServiceId } from "@/lib/services/registry";

/** Explicit names only: a game top-up or store balance is not automatically a gift card. */
export function isNamedGiftCard(name: string): boolean {
  return /\b(?:gift\s*cards?|gift\s*vouchers?|gift\s*codes?)\b/i.test(name);
}

export type DigitalFamily = Extract<ServiceId, "esim" | "subscriptions" | "games" | "topups" | "gift-cards" | "prepaid">;
export const DIGITAL_FAMILY_LABELS: Record<DigitalFamily, string> = {
  esim: "Travel eSIM", subscriptions: "Subscription", games: "Games & gaming",
  topups: "Account top-up", "gift-cards": "Gift card & store credit", prepaid: "Prepaid & finance",
};

/** Product purpose wins over supplier shelf and delivery mechanism. A code can
 * activate a subscription or credit a game; it is not a service family itself.
 * Unknown names must stay unclassified, never silently become order tools.
 * These rules organize browsing only and never authorize checkout. */
export function digitalServiceFamily(name: string, kind?: "codes" | "topups" | "esims", shelf?: string): DigitalFamily | null {
  if (kind === "esims" || /\be[ -]?sim\b/i.test(name)) return "esim";
  if (isNamedGiftCard(name)) return "gift-cards";
  if (/\bdisney\s*\+(?=\s|$)/i.test(name) || /\b(?:netflix|spotify|disney plus|youtube premium|telegram premium|discord nitro|crunchyroll|microsoft 365|office 365|adobe|canva pro|chatgpt|claude pro|perplexity pro|apple music|apple tv|amazon prime|prime video|hulu|deezer|tidal|paramount plus|playstation plus|xbox game pass|nintendo switch online)\b/i.test(name)) return "subscriptions";
  if (/\b(?:steam wallet|playstation (?:store|wallet)|xbox (?:gift|balance)|nintendo eshop|google\s*play|itunes|apple (?:gift|store credit))\b/i.test(name)) return "gift-cards";
  if (/\b(?:pubg|call of duty|codm|mobile legends|free fire|genshin|honkai|valorant|fortnite|roblox|brawl stars|clash of clans|clash royale|delta force|honor of kings|league of legends|apex legends|ea (?:fc|sports)|minecraft|world of warcraft)\b/i.test(name)) return "games";
  if (/\b(?:prepaid|virtual (?:visa|mastercard)|visa card|mastercard|astropay|paysafecard)\b/i.test(name)) return "prepaid";
  const shelves: Record<string, DigitalFamily> = {
    esim: "esim", subscriptions: "subscriptions", games: "games", "game-currency": "games", "gaming-services": "games",
    topups: "topups", "gift-cards": "gift-cards", "app-stores": "gift-cards", rewarble: "gift-cards", "prepaid-finance": "prepaid",
  };
  if (shelf && shelves[shelf]) return shelves[shelf];
  return kind === "topups" ? "topups" : null;
}
