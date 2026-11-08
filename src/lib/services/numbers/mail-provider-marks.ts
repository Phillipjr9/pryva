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
 *   2. An unknown provider keeps the neutral envelope. It must never borrow
 *      another provider's logo — a Hotmail inbox wearing the Gmail mark is a lie
 *      a customer cannot check.
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
   * A needle with a dot (`mail.ru`, `web.de`) or one longer than three
   * characters is matched as a substring; a short bare one (`qq`, `msn`) has to
   * match a whole word, so `qq` cannot fire on the middle of another word.
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
    // A dot already anchors the needle (mail.ru, web.de); a short bare token
    // like "qq" or "msn" is too easy to hit inside another word, so it must
    // stand alone.
    wholeWord: !text.includes(".") && text.length <= 3,
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
 * as "Outlook inbox". A miss returns null, and the caller draws the neutral
 * envelope — never another provider's mark.
 */
export function mailProviderBrand(name: string | null, domain?: string | null): BrandSlug | null {
  const haystack = `${name ?? ""} ${domain ?? ""}`.toLowerCase();
  if (!haystack.trim()) return null;
  for (const needle of MATCH_INDEX) {
    if (present(haystack, needle)) return needle.brand;
  }
  return null;
}
