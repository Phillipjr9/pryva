/**
 * Copies the country flags Pryva sells into `public/images/flags/`.
 *
 * Source: `flag-icons` (MIT). We copy rather than import because these are
 * static artwork served straight to the browser — no bundler involvement, and
 * the exact same SVG works in an <img>, a CSS background or an email.
 *
 * Run: `npm i --no-save flag-icons && node scripts/copy-flags.mjs`
 */
import { copyFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** ISO country/territory artwork is for the picker, not a coverage claim. */
const isoCountries = JSON.parse(readFileSync(new URL("../data/iso-countries.json", import.meta.url), "utf8"));
export const FLAG_CODES = [...new Set([
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
  ...isoCountries.map((country) => country.code.toLowerCase()),
])];

const src = "node_modules/flag-icons/flags/4x3";
const dest = "public/images/flags";
mkdirSync(dest, { recursive: true });
copyFileSync("node_modules/flag-icons/LICENSE", join(dest, "LICENSE.txt"));

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
