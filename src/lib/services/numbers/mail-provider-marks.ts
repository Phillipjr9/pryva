import type { BrandSlug } from "@/lib/content/brand-marks";

/**
 * Which mail provider a temporary-inbox listing belongs to.
 *
 * The inbox feed names a provider per listing, and every listing has to show
 * that provider's own logo. It used to be a six-branch `if` chain inside
 * `fleexa-catalog.ts` that returned null for everything it did not name, so GMX,
 * iCloud, Yandex, Tuta, mail.com, WEB.DE, QQ, Naver, AOL, Fastmail, Daum and
 * Mailinator all rendered the same generic envelope: seven different products
 * looked like one product.
 *
 * Two rules decide what lives here:
 *
 *   1. A provider gets an entry only if a real mark for it exists in
 *      `BRAND_MARKS` (extracted from the pinned open icon sets, never drawn by
 *      eye and never generated). Pointing at a slug that is not in that table
 *      would render nothing at all, which is worse than a neutral glyph — and
 *      the type of `brand` is `BrandSlug`, so a missing mark fails the build
 *      rather than shipping a blank tile.
 *   2. An unknown provider never borrows another provider's logo — a Hotmail
 *      inbox wearing the Gmail mark is a lie a customer cannot check. When the
 *      listing names a public site domain instead, the catalogue uses that
 *      site's own published favicon; only invalid/unavailable domains get the
 *      neutral envelope.
 *
 * This module is plain data so the server-only catalog can use it and the
 * browser bundle can be tested against it without pulling a provider client in.
 */

export type MailProviderMark = {
  /** Stable slug, also the test id. */
  slug: string;
  /** The real mark to draw. Must exist in `BRAND_MARKS`. */
  brand: BrandSlug;
  /**
   * Lowercased needles that identify the provider in a listing name or domain.
   * A dotted needle (`mail.ru`, `web.de`) or short bare token (`qq`, `msn`)
   * must match at a token boundary. Longer brand words are matched as
   * substrings, so `protonmail` can be found inside a product label.
   */
  match: readonly string[];
};

/**
 * Order matters: the first match wins, so a more specific name has to come
 * before a broader one that it contains. "google mail" belongs to Gmail, and
 * "mail.ru" has to be tried before mail.com's "mail.com"/"mailcom" needles so a
 * Mail.Ru address is never read as mail.com.
 */
export const MAIL_PROVIDER_MARKS: readonly MailProviderMark[] = [
  {
    slug: "gmail",
    brand: "gmail",
    match: ["gmail", "google mail", "googlemail"],
  },
  {
    slug: "outlook",
    brand: "outlook",
    match: ["outlook", "hotmail", "live mail", "live.com", "msn"],
  },
  {
    slug: "proton",
    brand: "protonmail",
    match: ["proton", "protonmail", "proton.me", "pm.me"],
  },
  {
    slug: "maildotru",
    brand: "maildotru",
    match: ["mail.ru", "maildotru", "mail ru", "bk.ru", "list.ru", "inbox.ru"],
  },
  {
    slug: "yahoo",
    brand: "yahoo",
    match: ["yahoo", "ymail", "rocketmail"],
  },
  {
    slug: "zoho",
    brand: "zoho",
    match: ["zoho", "zohomail"],
  },
  {
    slug: "gmx",
    brand: "gmx",
    match: ["gmx"],
  },
  {
    slug: "icloud",
    brand: "icloud",
    match: ["icloud", "me.com", "mac.com"],
  },
  {
    slug: "yandex",
    brand: "yandex",
    match: ["yandex", "ya.ru", "yandex.ru"],
  },
  {
    slug: "tuta",
    brand: "tuta",
    match: ["tuta", "tutanota"],
  },
  {
    slug: "qq",
    brand: "qq",
    match: ["qq.com", "qqmail", "qq mail", "qq"],
  },
  {
    slug: "maildotcom",
    brand: "maildotcom",
    // "mail.com" as a bare token, plus the "@mail.com" form: matching plain
    // "mail" would swallow every other provider in this table.
    match: ["mail.com", "@mail.com", "mailcom"],
  },
  {
    slug: "webdotde",
    brand: "webdotde",
    match: ["web.de", "webde"],
  },
  {
    slug: "naver",
    brand: "naver",
    match: ["naver"],
  },
];

type Needle = { readonly text: string; readonly brand: BrandSlug; readonly wholeWord: boolean };

const MATCH_INDEX: readonly Needle[] = MAIL_PROVIDER_MARKS.flatMap((provider) =>
  provider.match.map((text) => ({
    text,
    brand: provider.brand,
    // Dotted domains and short bare tokens need a boundary. Otherwise a domain
    // like "10minutemail.com" falsely contains the mail.com logo in its name.
    wholeWord: text.includes(".") || text.length <= 3,
  })),
);

function present(haystack: string, needle: Needle): boolean {
  if (!needle.wholeWord) return haystack.includes(needle.text);
  const escaped = needle.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack);
}

/**
 * The real mark for a provider named in `name` or `domain`, or null.
 *
 * Both fields are lowercased once and searched together: the feed sometimes
 * names a product only by its domain, so "outlook.com" has to resolve as surely
 * as "Outlook inbox". A miss returns null so the catalogue can try the listed
 * site's own favicon; it never guesses another provider's mark.
 */
export function mailProviderBrand(name: string | null, domain?: string | null): BrandSlug | null {
  const haystack = `${name ?? ""} ${domain ?? ""}`.toLowerCase();
  if (!haystack.trim()) return null;
  for (const needle of MATCH_INDEX) {
    if (present(haystack, needle)) return needle.brand;
  }
  return null;
}

/**
 * Resolve a listed site's domain for its own favicon. The feed can list a
 * verification service (adobe.com, airbnb.com, etc.), not a mail provider, so a
 * provider-only lookup leaves most of the real catalogue looking blank. A site
 * favicon is the site's own published mark, fetched by the tile component from
 * Google's favicon endpoint; it is not artwork we invent or bundle.
 *
 * Treat the supplier strings as untrusted: accept a hostname only, reject local
 * or reserved names, and never let arbitrary URLs, ports, credentials or IPs
 * into a browser image request.
 */
export function mailProviderFaviconDomain(name: string | null, domain?: string | null): string | null {
  for (const value of [domain, name]) {
    if (!value || value.length > 253) continue;
    const candidate = value.trim().toLowerCase().replace(/^https?:[/][/]/, "").split(/[/?#]/, 1)[0].replace(/[.]$/, "");
    if (!candidate || candidate.includes("@") || candidate.includes(":") || candidate.includes(String.fromCharCode(92))) continue;

    let hostname: string;
    try {
      hostname = new URL(`https://${candidate}`).hostname;
    } catch {
      continue;
    }
    if (hostname !== candidate || !hostname.includes(".")) continue;
    if (/^([0-9]{1,3}[.]){3}[0-9]{1,3}$/.test(hostname) || hostname.includes(":")) continue;
    const labels = hostname.split(".");
    if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) continue;
    const tld = labels.at(-1) ?? "";
    if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(tld)) continue;
    if (["test", "example", "invalid", "localhost", "local", "internal", "lan"].includes(tld)) continue;
    return hostname;
  }
  return null;
}
