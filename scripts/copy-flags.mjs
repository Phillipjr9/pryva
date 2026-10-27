/**
 * Copies the country flags Pryva sells into `public/images/flags/`.
 *
 * Source: `flag-icons` (MIT). We copy rather than import because these are
 * static artwork served straight to the browser — no bundler involvement, and
 * the exact same SVG works in an <img>, a CSS background or an email.
 *
 * Run: `npm i --no-save flag-icons && node scripts/copy-flags.mjs`
 */
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/** ISO-3166 alpha-2 codes: the markets in the catalogue plus the wider set the
 *  number/eSIM copy advertises ("40+ countries"), so new plans need no new art. */
export const FLAG_CODES = [
  // launch markets
  "ng", "us", "gb", "ca", "de", "gh",
  // Africa
  "ke", "za", "eg", "ma", "tz", "ug", "ci", "sn", "cm", "zm",
  // Europe
  "fr", "nl", "es", "it", "pt", "ie", "se", "no", "dk", "fi", "ch", "at",
  "be", "pl", "ro", "cz", "gr", "hu", "ua", "tr", "eu",
  // Middle East / Asia
  "ae", "sa", "qa", "il", "in", "pk", "bd", "ph", "id", "my", "sg", "th",
  "vn", "jp", "kr", "cn",
  // Americas / Oceania
  "mx", "br", "ar", "cl", "co", "au", "nz",
];

const src = "node_modules/flag-icons/flags/4x3";
const dest = "public/images/flags";
mkdirSync(dest, { recursive: true });

let copied = 0;
const missing = [];
for (const code of FLAG_CODES) {
  const from = join(src, `${code}.svg`);
  if (!existsSync(from)) {
    missing.push(code);
    continue;
  }
  copyFileSync(from, join(dest, `${code}.svg`));
  copied++;
}
console.log(`copied ${copied} flags to ${dest}`);
if (missing.length) console.log("missing in flag-icons:", missing.join(", "));
