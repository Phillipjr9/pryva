import { BRAND_MARKS, type BrandSlug } from "@/lib/content/brand-marks";
import index from "@/lib/services/numbers/verification-mark-index.json";

/**
 * Curated matches for digital products. Category image IDs are retained for
 * the fixed legacy artwork endpoint, but cards use the locally bundled product
 * icons; see public/digital-game-icons/SOURCES.txt. Names and marks remain the
 * property of their owners. Simple Icons files are CC0.
 *
 * Never guess from partial words, nor use a supplier-provided URL directly.
 * Unknown products get a neutral icon. Adding a match is cosmetic only.
 */
export const CATEGORY_ART = {
  "genshin-impact": true,
  "goddess-of-victory-nikke": true,
  "growtopia": true,
  "hay-day": true,
  "life-makeover": true,
  "lifeafter": true,
  "likee": true,
  "lords-mobile": true,
  "love-and-deepspace": true,
  "once-human": true,
  "pixel-gun-3d": true,
  "point-blank": true,
  "super-sus": true,
  "tft-mobile": true,
  "whiteout-survival": true,
  "wild-rift": true,
  "wuthering-waves": true,
  "yalla-ludo": true,
  "cod-mobile-activision": true,
  "cod-mobile-garena": true,
  "8-ball-pool": true,
  "oxide-survival-island": true,
  "age-of-empires-mobile": true,
  "ace-racer": true,
  "acecraft": true,
  "afk-journey": true,
  "age-of-magic": true,
  "arena-breakout-infinite": true,
  "arena-breakout": true,
  "arena-of-valor": true,
  "asphalt-9": true,
  "azur-lane": true,
  "bigo-live": true,
  "black-clover-m": true,
  "blood-strike": true,
  "brawl-stars": true,
  "bullet-echo": true,
  "clash-of-clans": true,
  "clash-royale": true,
  "delta-force": true,
  "ea-fc-mobile": true,
} as const;
export type CategoryArt = keyof typeof CATEGORY_ART;

/** Only call with a validated category key. Never turn a catalogue URL into a src. */
export function categoryArtworkSrc(key: CategoryArt): string {
  if (key === "likee") return "/verification-logos/social-likee.png";
  if (key === "cod-mobile-activision" || key === "cod-mobile-garena") return "/digital-brand-icons/call-of-duty-mobile.png";
  return `/digital-game-icons/${key}.webp`;
}

export type LocalArt = "astropay" | "call-of-duty-mobile" | "likee" | "apex-legends" | "ea-fc-26" | "nintendo-switch-online" | "nintendo-eshop";
export type DigitalArtwork = { kind: "local"; key: LocalArt } | { kind: "indexed"; key: string } | { kind: "category"; key: CategoryArt } | { kind: "brand"; key: BrandSlug } | { kind: "simple"; key: "pubg" | "fortnite" | "valorant" | "googleplay" | "itunes" };

// Longer/more specific matches must precede their shorter relatives.
const matches: ReadonlyArray<{ pattern: RegExp; art: DigitalArtwork }> = [
  { pattern: /^call[ -]of[ -]duty[ :\-]*mobile[ -]+\(?garena(?:\b|$)/, art: { kind: "local", key: "call-of-duty-mobile" } },
  { pattern: /^call[ -]of[ -]duty[ :\-]*mobile(?:\b|$)/, art: { kind: "local", key: "call-of-duty-mobile" } },
  { pattern: /^apple[ -]music(?:\b|$)/, art: { kind: "indexed", key: "applemusic" } },
  { pattern: /^youtube[ -]music(?:\b|$)/, art: { kind: "indexed", key: "youtubemusic" } },
  { pattern: /^youtube[ -]tv(?:\b|$)/, art: { kind: "indexed", key: "youtubetv" } },
  { pattern: /^playstation[ -]5(?:\b|$)/, art: { kind: "indexed", key: "playstation5" } },
  { pattern: /^astropay(?:[ -]gift[ -]card|[ -](?:bangladesh|brazil|egypt|india|indonesia|china|malaysia|pakistan|singapore|united[ -]states|thailand|philippines|japan)[ -]astropay[ -]gift[ -]card)(?:\b|$)/, art: { kind: "local", key: "astropay" } },
  { pattern: /^likee(?:\b|$)/, art: { kind: "local", key: "likee" } },
  { pattern: /^apex[ -]legends(?:\b|$)/, art: { kind: "local", key: "apex-legends" } },
  { pattern: /^ea[ -]sports[ -]fc[ -]26(?:\b|$)/, art: { kind: "local", key: "ea-fc-26" } },
  { pattern: /^nintendo[ -]switch[ -]online(?:\b|$)/, art: { kind: "local", key: "nintendo-switch-online" } },
  ...([ ["genshin-impact", /^genshin[ -]impact(?:\b|$)/], ["goddess-of-victory-nikke", /^goddess[ -]of[ -]victory[ :\-]+nikke(?:\b|$)/], ["growtopia", /^growtopia(?:\b|$)/], ["hay-day", /^hay[ -]day(?:\b|$)/], ["life-makeover", /^life[ -]makeover(?:\b|$)/], ["lifeafter", /^lifeafter(?:\b|$)/], ["lords-mobile", /^lords[ -]mobile(?:\b|$)/], ["love-and-deepspace", /^love[ -]and[ -]deepspace(?:\b|$)/], ["once-human", /^once[ -]human(?:\b|$)/], ["pixel-gun-3d", /^pixel[ -]gun[ -]3d(?:\b|$)/], ["point-blank", /^point[ -]blank(?:\b|$)/], ["super-sus", /^super[ -]sus(?:\b|$)/], ["tft-mobile", /^tft[ -]mobile(?:\b|$)/], ["whiteout-survival", /^whiteout[ -]survival(?:\b|$)/], ["wild-rift", /^wild[ -]rift(?:\b|$)/], ["wuthering-waves", /^wuthering[ -]waves(?:\b|$)/], ["yalla-ludo", /^yalla[ -]ludo(?:\b|$)/], ["arena-breakout-infinite", /^arena[ -]breakout[ :\-]+infinite(?:\b|$)/], ["arena-breakout", /^arena[ -]breakout(?:\b|$)/], ["8-ball-pool", /^8[ -]ball[ -]pool(?:\b|$)/], ["oxide-survival-island", /^oxide[ :\-]+survival[ -]island(?:\b|$)/], ["age-of-empires-mobile", /^age[ -]of[ -]empires?[ -]mobile(?:\b|$)/], ["ace-racer", /^ace[ -]racer(?:\b|$)/], ["acecraft", /^acecraft(?:\b|$)/], ["afk-journey", /^afk[ -]journey(?:\b|$)/], ["age-of-magic", /^age[ -]of[ -]magic(?:\b|$)/], ["arena-of-valor", /^arena[ -]of[ -]valor(?:\b|$)/], ["asphalt-9", /^asphalt[ -]9(?:\b|$)/], ["azur-lane", /^azur[ -]lane(?:\b|$)/], ["bigo-live", /^bigo[ -]live(?:\b|$)/], ["black-clover-m", /^black[ -]clover[ -]m(?:\b|$)/], ["blood-strike", /^blood[ -]strike(?:\b|$)/], ["brawl-stars", /^brawl[ -]stars(?:\b|$)/], ["bullet-echo", /^bullet[ -]echo(?:\b|$)/], ["clash-of-clans", /^clash[ -]of[ -]clans(?:\b|$)/], ["clash-royale", /^clash[ -]royale(?:\b|$)/], ["delta-force", /^delta[ -]force(?:\b|$)/], ["ea-fc-mobile", /^ea[ -]sports[ -]fc(?:™)?[ -]mobile(?:\b|$)/] ] as const).map(([key, pattern]) => ({ pattern, art: { kind: "category" as const, key } })),
  ...([ ["pubg", /^pubg(?:\b|$)/], ["fortnite", /^fortnite(?:\b|$)/], ["valorant", /^valorant(?:\b|$)/], ["googleplay", /^google[ -]play(?:\b|$)/] ] as const).map(([key, pattern]) => ({ pattern, art: { kind: "simple" as const, key } })),
  ...([ ["telegram", /^telegram(?:\b|$)/], ["steam", /^steam(?:\b|$)/], ["roblox", /^roblox(?:\b|$)/], ["playstation", /^(?:playstation|psn|ps[ -]store)(?:\b|$)/], ["xbox", /^xbox[ -](?:game[ -]pass|live)(?:\b|$)/], ["razer", /^razer(?:\b|$)/], ["netflix", /^netflix(?:\b|$)/], ["spotify", /^spotify(?:\b|$)/], ["youtube", /^youtube(?:\b|$)/], ["amazon", /^amazon(?:\b|$)/], ["apple", /^apple(?:\b|$)/], ["discord", /^discord(?:\b|$)/], ["twitch", /^twitch(?:\b|$)/], ["epicgames", /^epic[ -]games(?:\b|$)/], ["battledotnet", /^battle[.-]net(?:\b|$)/], ["airtel", /^airtel(?:\b|$)/] ] as const).map(([key, pattern]) => ({ pattern, art: { kind: "brand" as const, key } })),
];

const publishedMarks = index.marks as Record<string, string[]>;
const publishedSlugs = new Set(Object.values(publishedMarks).map(([slug]) => slug));
export const DIGITAL_ICON_VERSION = index.version;

/** Match the whole brand in an explicitly named gift card, or a structured
 * cw-brand-amount-currency slug. Colliding normalized titles are rejected.
 * In particular, no domain or mark is guessed from a random word. */
const slugTitles = new Map<string, string | null>();
for (const [title, [slug]] of Object.entries(publishedMarks)) {
  const normalized = title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!normalized || normalized.length < 3) continue;
  if (slugTitles.has(normalized) && slugTitles.get(normalized) !== slug) slugTitles.set(normalized, null);
  else if (!slugTitles.has(normalized)) slugTitles.set(normalized, slug);
}
function publishedGiftMark(name: string, slug?: string): DigitalArtwork | null {
  const match = name.trim().toLowerCase().match(/^(.{2,80}?)\s+(?:gift\s*card|gift\s*voucher)(?:\b|$)/);
  const label = match?.[1]?.trim();
  if (label) return Object.hasOwn(publishedMarks, label) ? { kind: "indexed", key: publishedMarks[label][0] } : null;
  const slugMatch = slug?.toLowerCase().match(/^cw-([a-z0-9-]{3,80})-\d+(?:-\d+)?-[a-z]{3}(?:-|$)/);
  const fromSlug = slugMatch ? slugTitles.get(slugMatch[1]) : null;
  return fromSlug ? { kind: "indexed", key: fromSlug } : null;
}

/** Product names or bounded provider slugs; never a generic category or keyword match. */
export function digitalArtwork(name: string, slug?: string): DigitalArtwork | null {
  // A named Xbox gift card is distinct from a game code for the Xbox platform.
  // Use the product name, not an incidental platform reference in a slug.
  if (/^(?:(?:[$€£]\s*)?\d[\d,.]*(?:\s*(?:usd|eur|gbp|brl|try|[$€£]))?\s+)?xbox\s+gift\s*card(?:\b|$)/i.test(name.trim())) {
    return { kind: "brand", key: "xbox" };
  }
  // Prefer the bundled mark for explicitly named Netflix cards over a remote
  // Simple Icons CDN request. Other named cards keep their own exact match.
  if (/^netflix\s+gift\s*(?:card|voucher)(?:\b|$)/i.test(name.trim())) {
    return { kind: "brand", key: "netflix" };
  }
  const explicitNamedGift = /^.{2,80}?\s+(?:gift\s*card|gift\s*voucher)(?:\b|$)/i;
  const itunesCard = /^(?:apple\s+)?itunes\s+gift\s*(?:card|voucher)(?:\b|$)/i.test(name.trim());
  const itunesValue = /^itunes\s+\d+(?:[.,]\d+)?\s+(?:inr|try|usd|eur|gbp)(?:\b|$)/i.test(name.trim());
  if (itunesCard || (itunesValue && !explicitNamedGift.test(name))) {
    return { kind: "simple", key: "itunes" };
  }
  if (/^nintendo\s+eshop\s+card(?:\b|$)/i.test(name.trim())) {
    return { kind: "local", key: "nintendo-eshop" };
  }
  if (/^google\s+play\s+gift\s*(?:card|voucher)(?:\b|$)/i.test(name.trim())) {
    return { kind: "simple", key: "googleplay" };
  }
  if (/^steam\s+(?:wallet\s+)?gift\s*(?:card|voucher)(?:\b|$)/i.test(name.trim())) {
    return { kind: "brand", key: "steam" };
  }
  // Use the parent Razer mark until a verified Razer Gold-specific asset is bundled.
  if (/^razer\s+gold\s+gift\s*(?:card|voucher)(?:\b|$)/i.test(name.trim())) {
    return { kind: "brand", key: "razer" };
  }
  // The supplier's Blizzard gift-card listing resolves to its Battle.net wallet card.
  if (/^(?:blizzard|battle\.net)\s+gift\s*(?:card|voucher)(?:\b|$)/i.test(name.trim())) {
    return { kind: "brand", key: "battledotnet" };
  }
  const giftMark = publishedGiftMark(name, slug);
  if (giftMark) return giftMark;
  const unrecognizedNamedGift = /^.{2,80}?\s+(?:gift\s*card|gift\s*voucher)(?:\b|$)/i.test(name);
  const candidates = [slug, name].filter((value): value is string => typeof value === "string" && value.length <= 256).map((value) => value.trim().toLowerCase());
  for (const text of candidates) {
    for (const { pattern, art } of matches) {
      // A broad platform prefix is not enough to identify a different branded product.
      if (unrecognizedNamedGift && (art.kind === "brand" || art.kind === "simple" || (art.kind === "local" && ["likee", "apex-legends", "ea-fc-26", "nintendo-switch-online"].includes(art.key)))) continue;
      if (pattern.test(text)) return art;
    }
  }
  return null;
}

/** Validate data crossing the API boundary; reject arbitrary image paths or marks. */
export function parseDigitalArtwork(value: unknown): DigitalArtwork | null {
  if (!value || typeof value !== "object") return null;
  const { kind, key } = value as Record<string, unknown>;
  if (typeof key !== "string") return null;
  if (kind === "local" && (key === "astropay" || key === "call-of-duty-mobile" || key === "likee" || key === "apex-legends" || key === "ea-fc-26" || key === "nintendo-switch-online" || key === "nintendo-eshop")) return { kind, key };
  if (kind === "indexed" && publishedSlugs.has(key)) return { kind, key };
  if (kind === "category" && Object.hasOwn(CATEGORY_ART, key)) return { kind, key: key as CategoryArt };
  if (kind === "brand" && Object.hasOwn(BRAND_MARKS, key)) return { kind, key: key as BrandSlug };
  if (kind === "simple" && (key === "pubg" || key === "fortnite" || key === "valorant" || key === "googleplay" || key === "itunes")) return { kind, key };
  return null;
}
