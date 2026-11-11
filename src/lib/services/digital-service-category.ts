import type { ServiceId } from "@/lib/services/registry";

/** Explicit names only: a game top-up or store balance is not automatically a gift card. */
export function isNamedGiftCard(name: string): boolean {
  return /\b(?:gift\s*cards?|gift\s*vouchers?|gift\s*codes?)\b/i.test(name);
}

export type DigitalFamily = Extract<ServiceId, "esim" | "subscriptions" | "games" | "topups" | "gift-cards" | "prepaid" | "accounts" | "data" | "numbers" | "verification" | "social" | "proxies">;
export const DIGITAL_FAMILY_LABELS: Record<DigitalFamily, string> = {
  accounts: "Social & Digital Accounts", data: "Mobile data & airtime", numbers: "Number plans",
  verification: "App verification", social: "Social promotion", proxies: "Proxies",
  esim: "Travel eSIM", subscriptions: "Subscription", games: "Games & gaming",
  topups: "Account top-up", "gift-cards": "Gift card & store credit", prepaid: "Prepaid & finance",
};

/** Product purpose wins over supplier shelf and delivery mechanism. A code can
 * activate a subscription or credit a game; it is not a service family itself.
 * Unknown names must stay unclassified, never silently become order tools.
 * These rules organize browsing only and never authorize checkout. */
export function digitalServiceFamily(name: string, kind?: "codes" | "topups" | "esims", shelf?: string): DigitalFamily | null {
  if (kind === "esims" || /\be[ -]?sim\b/i.test(name)) return "esim";
  // Explicit offering beats a platform brand (e.g. Telegram account vs Premium).
  if (/\b(?:proxies|proxy)\b/i.test(name)) return "proxies";
  if (/\b(?:followers?|likes?|subscribers?|views?|reposts?|retweets?)\b/i.test(name) && /\b(?:buy|boost|promotion|instagram|tiktok|youtube|telegram|facebook|twitter|social)\b/i.test(name)) return "social";
  if (/\b(?:sms verification|otp verification|verification code|sms activation|app verification)\b/i.test(name)) return "verification";
  if (/\b(?:aged|pre[ -]?registered|verified|full access|fresh)\b.*\baccounts?\b/i.test(name) || /\b(?:facebook|instagram|tiktok|telegram|discord|netflix|spotify|steam|gmail|outlook|twitter|chatgpt)\s+accounts?\b/i.test(name)) return "accounts";
  if (/\b(?:airtime|mobile data|data bundle|mobile recharge)\b/i.test(name)) return "data";
  if (/\b(?:phone number rental|virtual number|number rental|number plan)\b/i.test(name)) return "numbers";
  if (isNamedGiftCard(name)) return "gift-cards";
  if (/\bdisney\s*\+(?=\s|$)/i.test(name) || /\b(?:netflix|spotify|disney plus|youtube premium|telegram premium|discord nitro|crunchyroll|microsoft 365|office 365|adobe|canva pro|chatgpt|claude pro|perplexity pro|apple music|apple tv|amazon prime|prime video|hulu|deezer|tidal|paramount plus|playstation plus|xbox game pass|nintendo switch online)\b/i.test(name)) return "subscriptions";
  // Names returned by whole-catalogue search may have no subscription shelf
  // context. Recognize explicit subscriptions and known subscription products,
  // without treating every "Premium" game bundle as a subscription.
  if (/\b(?:subscriptions?|memberships?)\b/i.test(name) ||
      /\b(?:youtube music|youtube family|yandex plus|duolingo|super duolingo|nordvpn|surfshark|expressvpn|proton (?:vpn|mail|pass)|windscribe|mullvad|cyberghost|kaspersky|bitdefender|norton 360|malwarebytes|avast|eset|microsoft copilot|github copilot|cursor pro|windsurf pro|grok|midjourney|elevenlabs|runway|capcut pro|adobe creative cloud|notion (?:plus|business|ai)|grammarly|quillbot|zoom pro|google one|google ai|gemini (?:advanced|pro)|icloud\+?|dropbox|evernote|figma|mubi|showmax|discovery plus|paramount\+|apple one|ea play|ubisoft\+)\b/i.test(name) ||
      /\b(?:hbo max|max streaming|hbo go)\b/i.test(name)) return "subscriptions";
  if (/\b(?:steam wallet|playstation (?:store|wallet)|xbox (?:gift|balance)|nintendo eshop|google\s*play|itunes|apple (?:gift|store credit))\b/i.test(name)) return "gift-cards";
  if (/\b(?:pubg|call of duty|codm|mobile legends|free fire|genshin|honkai|valorant|fortnite|roblox|brawl stars|clash of clans|clash royale|delta force|honor of kings|league of legends|apex legends|ea (?:fc|sports)|minecraft|world of warcraft)\b/i.test(name)) return "games";
  if (/\b(?:prepaid|virtual (?:visa|mastercard)|visa card|mastercard|astropay|paysafecard)\b/i.test(name)) return "prepaid";
  if (/\b(?:telegram stars|tiktok coins|bigo (?:live|diamonds)|likee diamonds|twitch bits)\b/i.test(name)) return "topups";
  const shelves: Record<string, DigitalFamily> = {
    esim: "esim", subscriptions: "subscriptions", games: "games", "game-currency": "games", "gaming-services": "games",
    topups: "topups", "gift-cards": "gift-cards", "app-stores": "gift-cards", rewarble: "gift-cards", "prepaid-finance": "prepaid",
  };
  if (shelf && shelves[shelf]) return shelves[shelf];
  return kind === "topups" ? "topups" : null;
}
