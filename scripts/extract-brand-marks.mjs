/**
 * Generates `src/lib/brand-marks.ts` from official open icon sources.
 *
 * Run:
 *   npm i --no-save simple-icons @iconify-json/logos devicon
 *   node scripts/extract-brand-marks.mjs
 *
 * Sources: simple-icons (CC0 data), @iconify-json/logos (CC0 set),
 * devicon (MIT) for Canva. Brands remain the trademarks of their owners; the
 * marks are used for identification of the product being sold, nothing else.
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const require = createRequire("/home/user/pryva/package.json");

const si = require("simple-icons");
const logos = require("@iconify-json/logos/icons.json");

/** slug -> {title, hex, viewBox, body} */
const out = {};

function fromSimple(name, slug, hexOverride) {
  const icon = si[name];
  if (!icon) throw new Error("missing simple-icon " + name);
  out[slug] = { title: icon.title, hex: hexOverride ?? "#" + icon.hex, viewBox: "0 0 24 24", body: `<path d="${icon.path}"/>`, source: "simple-icons" };
}

function fromLogos(name, slug, hexOverride, title) {
  const icon = logos.icons[name];
  if (!icon) throw new Error("missing logos icon " + name);
  const w = icon.width ?? logos.width;
  const h = icon.height ?? logos.height;
  out[slug] = {
    title: title ?? name,
    hex: hexOverride ?? "",
    viewBox: `0 0 ${w} ${h}`,
    body: icon.body,
    source: "logos (CC0 set)",
  };
}

fromSimple("siNetflix", "netflix", "#E50914");
fromSimple("siSpotify", "spotify", "#1DB954");
fromSimple("siYoutube", "youtube", "#FF0033");
fromSimple("siFacebook", "facebook", "#0866FF");
fromSimple("siInstagram", "instagram", "#E4405F");
fromSimple("siTiktok", "tiktok", "#000000");

fromSimple("siX", "x", "#000000");
fromSimple("siTelegram", "telegram", "#26A5E4");
fromSimple("siWhatsapp", "whatsapp", "#25D366");
fromSimple("siDiscord", "discord", "#5865F2");
fromSimple("siSteam", "steam", "#1B2838");
fromSimple("siAirtel", "airtel", "#E40000");
fromSimple("siApple", "apple", "#000000");

fromSimple("siHbomax", "hbo-max", "#002BE7");

fromSimple("siCrunchyroll", "crunchyroll", "#FF5E00");

// Also commonly sold / verified on the accounts marketplace.
fromSimple("siBinance", "binance", "#F0B90B");
fromSimple("siOkx", "okx", "#000000");
fromSimple("siPaypal", "paypal", "#003087");
fromSimple("siUber", "uber", "#000000");
fromSimple("siSnapchat", "snapchat", "#FFFC00");
fromSimple("siTinder", "tinder", "#FF6B6B");
fromSimple("siCoinbase", "coinbase", "#0052FF");
fromSimple("siRevolut", "revolut", "#000000");
fromSimple("siCashapp", "cashapp", "#00C244");
fromSimple("siVenmo", "venmo", "#008CFF");
fromSimple("siPinterest", "pinterest", "#BD081C");
fromSimple("siReddit", "reddit", "#FF4500");
fromSimple("siTwitch", "twitch", "#9146FF");
fromSimple("siAirbnb", "airbnb", "#FF5A5F");
fromSimple("siBookingdotcom", "booking", "#003B95");
fromSimple("siWechat", "wechat", "#07C160");
fromSimple("siZoom", "zoom", "#0B5CFF");

fromLogos("openai-icon", "chatgpt", "#10A37F", "ChatGPT");
// Gmail: the plain red "M" silhouette. The multi-colour artwork on the icon
// sets relies on fixed SVG gradient ids, and duplicate ids break the moment two
// badges share a page (every /accounts grid does).
fromSimple("siGmail", "gmail", "#EA4335");
// Google ships as solid multi-colour paths — no defs, safe to repeat.
fromLogos("google-icon", "google", "", "Google");

// Canva: devicon's original mark (multi-colour), MIT-licensed source files.
const canva = readFileSync("/tmp/probe/node_modules/devicon/icons/canva/canva-original.svg", "utf8");
const canvaBody = canva.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
out.canva = { title: "Canva", hex: "#00C4CC", viewBox: "0 0 128 128", body: canvaBody.trim(), source: "devicon (MIT)" };

const lines = [];
lines.push(`/**
 * Real brand marks for the third-party products and platforms Pryva resells.
 *
 * Generated from official open icon sources — do not hand-edit the path data:
 *   \`simple-icons\` (CC0 path data, brands keep their own trademarks),
 *   \`@iconify-json/logos\` (CC0 set), and \`devicon\` (MIT) for Canva.
 * Re-extract with \`scripts/extract-brand-marks.mjs\` after bumping those packages.
 *
 * Each mark keeps its OWN aspect ratio and brand colour, which is what makes it
 * look right next to the others. Never redraw these by eye and never generate
 * them with an image model.
 */
export type BrandMark = {
  /** Accessible name of the product, e.g. "Netflix". */
  title: string;
  /** Official brand colour. Empty string means "the mark carries its own fills". */
  hex: string;
  viewBox: string;
  /** Inner SVG markup — paths only, no <svg> wrapper. */
  body: string;
};

export const BRAND_MARKS = {`);
for (const [slug, mark] of Object.entries(out)) {
  lines.push(`  ${JSON.stringify(slug)}: {`);
  lines.push(`    title: ${JSON.stringify(mark.title)},`);
  lines.push(`    hex: ${JSON.stringify(mark.hex)},`);
  lines.push(`    viewBox: ${JSON.stringify(mark.viewBox)},`);
  lines.push(`    body: ${JSON.stringify(mark.body)},`);
  lines.push(`  },`);
}
lines.push(`} as const satisfies Record<string, BrandMark>;`);
lines.push(``);
lines.push(`export type BrandSlug = keyof typeof BRAND_MARKS;`);
lines.push(``);
lines.push(`export function brandMark(slug: string): BrandMark | undefined {`);
lines.push(`  return (BRAND_MARKS as Record<string, BrandMark>)[slug];`);
lines.push(`}`);
lines.push(``);

writeFileSync("/home/user/pryva/src/lib/brand-marks.ts", lines.join("\n"));
console.log("wrote brand-marks.ts", Object.keys(out).length, "marks");
for (const k of Object.keys(out)) console.log(" -", k, out[k].viewBox, out[k].body.length);
