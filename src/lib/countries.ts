/**
 * Country data for flags, dial codes and the "40+ countries" copy.
 *
 * Flags live in `public/images/flags/<iso2>.svg` (copied from `flag-icons`, MIT —
 * see `scripts/copy-flags.mjs`). Real flag artwork, never generated: a wrong flag
 * is worse than no flag, especially for a Nigeria-first product.
 */

export type Country = {
  /** ISO-3166 alpha-2, lowercase — also the flag filename. */
  code: string;
  name: string;
  /** International dialling prefix. */
  dial: string;
};

export const COUNTRIES: Country[] = [
  { code: "ng", name: "Nigeria", dial: "+234" },
  { code: "us", name: "United States", dial: "+1" },
  { code: "gb", name: "United Kingdom", dial: "+44" },
  { code: "ca", name: "Canada", dial: "+1" },
  { code: "de", name: "Germany", dial: "+49" },
  { code: "gh", name: "Ghana", dial: "+233" },
  { code: "ke", name: "Kenya", dial: "+254" },
  { code: "za", name: "South Africa", dial: "+27" },
  { code: "eg", name: "Egypt", dial: "+20" },
  { code: "ma", name: "Morocco", dial: "+212" },
  { code: "tz", name: "Tanzania", dial: "+255" },
  { code: "ug", name: "Uganda", dial: "+256" },
  { code: "ci", name: "Côte d'Ivoire", dial: "+225" },
  { code: "sn", name: "Senegal", dial: "+221" },
  { code: "cm", name: "Cameroon", dial: "+237" },
  { code: "zm", name: "Zambia", dial: "+260" },
  { code: "fr", name: "France", dial: "+33" },
  { code: "nl", name: "Netherlands", dial: "+31" },
  { code: "es", name: "Spain", dial: "+34" },
  { code: "it", name: "Italy", dial: "+39" },
  { code: "pt", name: "Portugal", dial: "+351" },
  { code: "ie", name: "Ireland", dial: "+353" },
  { code: "se", name: "Sweden", dial: "+46" },
  { code: "no", name: "Norway", dial: "+47" },
  { code: "dk", name: "Denmark", dial: "+45" },
  { code: "fi", name: "Finland", dial: "+358" },
  { code: "ch", name: "Switzerland", dial: "+41" },
  { code: "at", name: "Austria", dial: "+43" },
  { code: "be", name: "Belgium", dial: "+32" },
  { code: "pl", name: "Poland", dial: "+48" },
  { code: "ro", name: "Romania", dial: "+40" },
  { code: "cz", name: "Czechia", dial: "+420" },
  { code: "gr", name: "Greece", dial: "+30" },
  { code: "hu", name: "Hungary", dial: "+36" },
  { code: "ua", name: "Ukraine", dial: "+380" },
  { code: "tr", name: "Türkiye", dial: "+90" },
  { code: "ae", name: "United Arab Emirates", dial: "+971" },
  { code: "sa", name: "Saudi Arabia", dial: "+966" },
  { code: "qa", name: "Qatar", dial: "+974" },
  { code: "il", name: "Israel", dial: "+972" },
  { code: "in", name: "India", dial: "+91" },
  { code: "pk", name: "Pakistan", dial: "+92" },
  { code: "bd", name: "Bangladesh", dial: "+880" },
  { code: "ph", name: "Philippines", dial: "+63" },
  { code: "id", name: "Indonesia", dial: "+62" },
  { code: "my", name: "Malaysia", dial: "+60" },
  { code: "sg", name: "Singapore", dial: "+65" },
  { code: "th", name: "Thailand", dial: "+66" },
  { code: "vn", name: "Vietnam", dial: "+84" },
  { code: "jp", name: "Japan", dial: "+81" },
  { code: "kr", name: "South Korea", dial: "+82" },
  { code: "cn", name: "China", dial: "+86" },
  { code: "mx", name: "Mexico", dial: "+52" },
  { code: "br", name: "Brazil", dial: "+55" },
  { code: "ar", name: "Argentina", dial: "+54" },
  { code: "cl", name: "Chile", dial: "+56" },
  { code: "co", name: "Colombia", dial: "+57" },
  { code: "au", name: "Australia", dial: "+61" },
  { code: "nz", name: "New Zealand", dial: "+64" },
];

/** Regional products map to the flag that stands for the bloc. */
const REGION_FLAGS: Record<string, { code: string; label: string }> = {
  europe: { code: "eu", label: "European Union" },
  "european union": { code: "eu", label: "European Union" },
  eu: { code: "eu", label: "European Union" },
};

/** Alternative spellings that appear in plan data, marketing copy and orders. */
const ALIASES: Record<string, string> = {
  usa: "us",
  "u.s.": "us",
  "u.s.a.": "us",
  "united states of america": "us",
  america: "us",
  uk: "gb",
  "u.k.": "gb",
  "great britain": "gb",
  britain: "gb",
  england: "gb",
  deutschland: "de",
  holland: "nl",
  "cote d'ivoire": "ci",
  "ivory coast": "ci",
  turkey: "tr",
  "south korea": "kr",
  korea: "kr",
  uae: "ae",
  emirates: "ae",
};

const BY_CODE = new Map(COUNTRIES.map((country) => [country.code, country]));
const BY_NAME = new Map(COUNTRIES.map((country) => [country.name.toLowerCase(), country]));

/**
 * Resolve a free-text region (`"Nigeria"`, `"US"`, `"Europe (38 countries)"`)
 * to a flag. Returns null for bundles that have no single flag (Africa, Global).
 */
export function countryFor(region: string | null | undefined): Country | null {
  if (!region) return null;

  // Plan labels use uppercase ISO codes ("US · 30 days", "NG · 7 days", "EU").
  // Match those before lowercasing, so "US" is not lost to the word rules.
  const codeToken = region.match(/\b(UK|US|NG|CA|DE|GH|ZA|KE|IN|AE|FR|NL)\b/);
  if (codeToken) {
    const code = codeToken[1] === "UK" ? "gb" : codeToken[1].toLowerCase();
    const match = BY_CODE.get(code);
    if (match) return match;
  }

  const cleaned = region
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b\d+\+?\s*countries?\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!cleaned) return null;
  if (BY_NAME.has(cleaned)) return BY_NAME.get(cleaned)!;
  if (ALIASES[cleaned]) return BY_CODE.get(ALIASES[cleaned]) ?? null;

  // "Nigeria rental", "US · 30 days", "Netflix Nigeria"
  for (const [name, country] of BY_NAME) {
    if (cleaned.includes(name)) return country;
  }
  for (const [alias, code] of Object.entries(ALIASES)) {
    if (new RegExp(`(^|\\s)${alias}(\\s|$)`).test(cleaned)) return BY_CODE.get(code) ?? null;
  }
  return null;
}

/** Bloc flag (EU) for regional plans, if one exists. */
export function regionFlagFor(region: string | null | undefined): { code: string; label: string } | null {
  if (!region) return null;
  const cleaned = region.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return REGION_FLAGS[cleaned] ?? REGION_FLAGS[cleaned.split(" ")[0]] ?? null;
}

/** True when a real flag exists for this region string (bundles like "Global" have none). */
export function hasCountryFlag(region: string | null | undefined): boolean {
  return Boolean(countryFor(region) ?? regionFlagFor(region));
}

export function flagSrc(code: string): string {
  return `/images/flags/${code}.svg`;
}

export function dialCodeFor(region: string | null | undefined): string | null {
  return countryFor(region)?.dial ?? null;
}

export const COUNTRY_COUNT = COUNTRIES.length;
