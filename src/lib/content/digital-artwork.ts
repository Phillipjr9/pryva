import { BRAND_MARKS, type BrandSlug } from "@/lib/content/brand-marks";
import index from "@/lib/services/numbers/verification-mark-index.json";

/**
 * Curated matches for FoxReload products. Supplier category thumbnails are
 * identified from its public category tree; they are product artwork, not a
 * claim that FoxReload created or owns a logo. Simple Icons files are CC0;
 * the brand names and marks remain the property of their owners.
 *
 * Never guess from partial words, nor use a supplier-provided URL directly.
 * Unknown products get a neutral icon. Adding a match is cosmetic only.
 */
export const CATEGORY_ART = {
  "genshin-impact": "0feed9a5-7a24-4786-a7d6-5bee8ccd9bc3",
  "goddess-of-victory-nikke": "399c1544-0037-4562-a221-b339f9637124",
  "growtopia": "1ded016e-1d65-4006-bc1e-873d3ccc3295",
  "hay-day": "5b027064-3b16-4fd1-8068-f760f8f7189c",
  "life-makeover": "83b39462-f793-411d-b29c-cc7e96ce05b6",
  "lifeafter": "5366cbb2-0055-4971-a19f-635aa1856eb0",
  "likee": "02e3e19c-c6e6-4b23-bc76-e789520d18cb",
  "lords-mobile": "ca093a9a-23e6-4b89-80e9-db73991b20bb",
  "love-and-deepspace": "b0f9ea96-0ba5-4e6d-a120-04eea56b5eb0",
  "once-human": "5db12b22-2d37-4616-9021-a8c6d2df888d",
  "pixel-gun-3d": "ac99200d-9c7a-48fe-996d-397c34ffb99b",
  "point-blank": "49ec0002-0586-4a04-b68a-b81f801e0cf7",
  "super-sus": "1e91278a-0e2c-4ce1-a3a1-d5017e6ca2ad",
  "tft-mobile": "b3eebb5a-a8f6-4e68-9505-7c67ef1812dd",
  "whiteout-survival": "95651da1-58ba-4cf9-a118-004410ba4576",
  "wild-rift": "0556ab26-f841-40bd-abab-192fce799325",
  "wuthering-waves": "eb35b184-2f90-4d9a-a62f-c9612e435c5b",
  "yalla-ludo": "80b36fb1-9921-4708-a1fa-ec57d23d399d",
  "cod-mobile-activision": "70da3322-fbaa-4c11-8d39-d79061e6bde7",
  "cod-mobile-garena": "f5043e00-88d7-4adb-a42f-2e80d341ee6b",
  "8-ball-pool": "7b7af303-0c46-4eb9-99c5-0da2df7bf71d",
  "ace-racer": "1613d1aa-75b3-44cb-b189-bf0a2e583a6b",
  "acecraft": "4930083a-b0de-4353-ab7a-f6c9d2894714",
  "afk-journey": "5549e43c-0afb-4c67-93c6-c379c2eeccb5",
  "age-of-magic": "86168aba-08ba-4225-be7d-b78b1fc96cc6",
  "arena-breakout-infinite": "35fb19ae-f6f3-4ec3-8c26-65889603b018",
  "arena-breakout": "8003b202-1d6e-420c-afb1-e6ff68e288f7",
  "arena-of-valor": "5fdc0932-774d-43b1-adf1-deda30ece7e7",
  "asphalt-9": "5366f577-b959-4930-b48a-9885c004b469",
  "azur-lane": "d69a4171-fb9b-45d9-86aa-6b837d641b58",
  "bigo-live": "621ee407-bc7e-4541-ada9-b8a61997dc01",
  "black-clover-m": "47253045-3c5a-48cc-b51d-e4283787431b",
  "blood-strike": "7205e7a4-c679-4f99-99b9-0bb31a5bd685",
  "brawl-stars": "aa4fbd53-809c-4d4d-90af-13f8f960c982",
  "bullet-echo": "c177f827-4aa7-436b-8852-1358b7c4a771",
  "clash-of-clans": "e8c263f3-6857-4e01-a21c-b7f00b457dee",
  "clash-royale": "7ad105de-8a3a-4009-abbf-85f73ef075f0",
  "delta-force": "d84d5adb-7581-4f7d-ad25-5e0a02eaae4a",
  "ea-fc-mobile": "d467b652-4824-4fcc-8343-f1874bfcb306",
} as const;
export type CategoryArt = keyof typeof CATEGORY_ART;
export type LocalArt = "astropay" | "call-of-duty-mobile";
export type DigitalArtwork = { kind: "local"; key: LocalArt } | { kind: "indexed"; key: string } | { kind: "category"; key: CategoryArt } | { kind: "brand"; key: BrandSlug } | { kind: "simple"; key: "pubg" | "fortnite" | "valorant" | "googleplay" };

// Longer/more specific matches must precede their shorter relatives.
const matches: ReadonlyArray<{ pattern: RegExp; art: DigitalArtwork }> = [
  { pattern: /^call[ -]of[ -]duty[ :\-]*mobile[ -]+\(?garena(?:\b|$)/, art: { kind: "local", key: "call-of-duty-mobile" } },
  { pattern: /^call[ -]of[ -]duty[ :\-]*mobile(?:\b|$)/, art: { kind: "local", key: "call-of-duty-mobile" } },
  { pattern: /^apple[ -]music(?:\b|$)/, art: { kind: "indexed", key: "applemusic" } },
  { pattern: /^youtube[ -]music(?:\b|$)/, art: { kind: "indexed", key: "youtubemusic" } },
  { pattern: /^youtube[ -]tv(?:\b|$)/, art: { kind: "indexed", key: "youtubetv" } },
  { pattern: /^playstation[ -]5(?:\b|$)/, art: { kind: "indexed", key: "playstation5" } },
  { pattern: /^astropay(?:[ -]gift[ -]card|[ -](?:bangladesh|brazil|egypt|india|indonesia|china|malaysia|pakistan|singapore|united[ -]states|thailand|philippines|japan)[ -]astropay[ -]gift[ -]card)(?:\b|$)/, art: { kind: "local", key: "astropay" } },
  ...([ ["genshin-impact", /^genshin[ -]impact(?:\b|$)/], ["goddess-of-victory-nikke", /^goddess[ -]of[ -]victory[ :\-]+nikke(?:\b|$)/], ["growtopia", /^growtopia(?:\b|$)/], ["hay-day", /^hay[ -]day(?:\b|$)/], ["life-makeover", /^life[ -]makeover(?:\b|$)/], ["lifeafter", /^lifeafter(?:\b|$)/], ["likee", /^likee(?:\b|$)/], ["lords-mobile", /^lords[ -]mobile(?:\b|$)/], ["love-and-deepspace", /^love[ -]and[ -]deepspace(?:\b|$)/], ["once-human", /^once[ -]human(?:\b|$)/], ["pixel-gun-3d", /^pixel[ -]gun[ -]3d(?:\b|$)/], ["point-blank", /^point[ -]blank(?:\b|$)/], ["super-sus", /^super[ -]sus(?:\b|$)/], ["tft-mobile", /^tft[ -]mobile(?:\b|$)/], ["whiteout-survival", /^whiteout[ -]survival(?:\b|$)/], ["wild-rift", /^wild[ -]rift(?:\b|$)/], ["wuthering-waves", /^wuthering[ -]waves(?:\b|$)/], ["yalla-ludo", /^yalla[ -]ludo(?:\b|$)/], ["arena-breakout-infinite", /^arena[ -]breakout[ :\-]+infinite(?:\b|$)/], ["arena-breakout", /^arena[ -]breakout(?:\b|$)/], ["8-ball-pool", /^8[ -]ball[ -]pool(?:\b|$)/], ["ace-racer", /^ace[ -]racer(?:\b|$)/], ["acecraft", /^acecraft(?:\b|$)/], ["afk-journey", /^afk[ -]journey(?:\b|$)/], ["age-of-magic", /^age[ -]of[ -]magic(?:\b|$)/], ["arena-of-valor", /^arena[ -]of[ -]valor(?:\b|$)/], ["asphalt-9", /^asphalt[ -]9(?:\b|$)/], ["azur-lane", /^azur[ -]lane(?:\b|$)/], ["bigo-live", /^bigo[ -]live(?:\b|$)/], ["black-clover-m", /^black[ -]clover[ -]m(?:\b|$)/], ["blood-strike", /^blood[ -]strike(?:\b|$)/], ["brawl-stars", /^brawl[ -]stars(?:\b|$)/], ["bullet-echo", /^bullet[ -]echo(?:\b|$)/], ["clash-of-clans", /^clash[ -]of[ -]clans(?:\b|$)/], ["clash-royale", /^clash[ -]royale(?:\b|$)/], ["delta-force", /^delta[ -]force(?:\b|$)/], ["ea-fc-mobile", /^ea[ -]sports[ -]fc(?:™)?[ -]mobile(?:\b|$)/] ] as const).map(([key, pattern]) => ({ pattern, art: { kind: "category" as const, key } })),
  ...([ ["pubg", /^pubg(?:\b|$)/], ["fortnite", /^fortnite(?:\b|$)/], ["valorant", /^valorant(?:\b|$)/], ["googleplay", /^google[ -]play(?:\b|$)/] ] as const).map(([key, pattern]) => ({ pattern, art: { kind: "simple" as const, key } })),
  ...([ ["telegram", /^telegram(?:\b|$)/], ["steam", /^steam(?:\b|$)/], ["roblox", /^roblox(?:\b|$)/], ["playstation", /^(?:playstation|psn)(?:\b|$)/], ["xbox", /^xbox(?:\b|$)/], ["razer", /^razer(?:\b|$)/], ["netflix", /^netflix(?:\b|$)/], ["spotify", /^spotify(?:\b|$)/], ["youtube", /^youtube(?:\b|$)/], ["amazon", /^amazon(?:\b|$)/], ["apple", /^apple(?:\b|$)/], ["discord", /^discord(?:\b|$)/], ["twitch", /^twitch(?:\b|$)/], ["epicgames", /^epic[ -]games(?:\b|$)/], ["battledotnet", /^battle[.-]net(?:\b|$)/], ["airtel", /^airtel(?:\b|$)/] ] as const).map(([key, pattern]) => ({ pattern, art: { kind: "brand" as const, key } })),
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
  const giftMark = publishedGiftMark(name, slug);
  if (giftMark) return giftMark;
  const unrecognizedNamedGift = /^.{2,80}?\s+(?:gift\s*card|gift\s*voucher)(?:\b|$)/i.test(name);
  const candidates = [slug, name].filter((value): value is string => typeof value === "string" && value.length <= 256).map((value) => value.trim().toLowerCase());
  for (const text of candidates) {
    for (const { pattern, art } of matches) {
      // A broad platform prefix is not enough to identify a different branded product.
      if (unrecognizedNamedGift && (art.kind === "brand" || art.kind === "simple")) continue;
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
  if (kind === "local" && (key === "astropay" || key === "call-of-duty-mobile")) return { kind, key };
  if (kind === "indexed" && publishedSlugs.has(key)) return { kind, key };
  if (kind === "category" && Object.hasOwn(CATEGORY_ART, key)) return { kind, key: key as CategoryArt };
  if (kind === "brand" && Object.hasOwn(BRAND_MARKS, key)) return { kind, key: key as BrandSlug };
  if (kind === "simple" && (key === "pubg" || key === "fortnite" || key === "valorant" || key === "googleplay")) return { kind, key };
  return null;
}
