import "server-only";
import type { ExplorerArtwork } from "@/lib/services/service-explorer";

/**
 * Explicitly reviewed labels from the social catalogue, mapped to their own
 * locally bundled Simple Icons marks. This table is cosmetic only: it must not
 * change platform classification, product eligibility, pricing or ordering.
 * Never infer an icon from a vaguely similar word or a supplier-provided URL.
 */
const SOCIAL_MARKS: Readonly<Record<string, string>> = {
  "shopee": "shopee",
  "clubhouse": "clubhouse",
  "coinmarketcap": "coinmarketcap",
  "rumble": "rumble",
  "tidal": "tidal",
  "ok.ru": "odnoklassniki",
  "apple music": "applemusic",
  "shazam": "shazam",
  "bluesky": "bluesky",
  "rednote": "xiaohongshu",
  "reverbenation": "reverbnation", // Supplier's spelling; the product names say Reverbnation.
  "line": "line",
};

/** Only these unambiguous, bounded product-name prefixes are used when the
 * supplier has placed a service in the catch-all "Other platforms" group. */
// Source and licence information for each raster file is in social/SOURCES.txt.
const RASTER_MARKS: Readonly<Record<string, string>> = {
  "likee": "likee",
  "boomplay": "boomplay",
  "rutube.ru": "rutube",
  "line voom": "line-voom",
  "trovo": "trovo",
};

const OTHER_PREFIXES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^rarible(?=$|[\s|:[(\-])/i, "rarible"],
  [/^opensea(?=$|[\s|:[(\-])/i, "opensea"],
  [/^coinmarketcap(?=$|[\s|:[(\-])/i, "coinmarketcap"],
];

export function socialArtwork(platform: string | null, cleanName: string | null): ExplorerArtwork | null {
  const normalized = platform?.trim().toLowerCase() ?? "";
  // Yandex Q is a different service; only explicitly named Zen listings can
  // use the Zen icon. Generic "Yandex" offers stay unassigned.
  if (normalized === "yandex" && /^yandex[\s.-]+zen(?=$|[\s|:[(\-])/i.test(cleanName ?? "")) {
    return { kind: "verified-brand-logo", slug: "social-yandex-zen", format: "png" };
  }
  if (Object.hasOwn(RASTER_MARKS, normalized)) {
    return { kind: "verified-brand-logo", slug: `social-${RASTER_MARKS[normalized]}`, format: "png" };
  }
  let slug = Object.hasOwn(SOCIAL_MARKS, normalized) ? SOCIAL_MARKS[normalized] : undefined;
  // "medium quality" is not the Medium publishing platform. Only its name
  // followed directly by an explicit social action identifies that platform.
  if (normalized === "medium" && /^medium\s+(?:followers?|likes?|comments?|views?|subscribers?)\b/i.test(cleanName ?? "")) slug = "medium";
  if (normalized === "other platforms" && cleanName) {
    slug = OTHER_PREFIXES.find(([pattern]) => pattern.test(cleanName))?.[1];
  }
  return slug ? { kind: "verified-brand-logo", slug: `social-${slug}` } : null;
}
