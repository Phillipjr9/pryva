import "server-only";
import index from "./verification-mark-index.json";
import verifiedBrands from "./verified-brand-logos.json";
import type { ExplorerArtwork } from "@/lib/services/service-explorer";

/** Exact supplier labels and their official websites, checked individually.
 * Do not derive domains from names: a plausible domain may be another business.
 */
const SITES: Readonly<Record<string, string>> = {
  "25clicks": "25clicks.com",
  "7eleven": "7-eleven.com",
  "85c bakery cafe": "85cbakerycafe.com",
  "99ranch": "99ranch.com",
  "academy sports and outdoors": "academy.com",
  "acima": "acima.com",
};

/** Match only complete names. Unknown or ambiguous names must not wear the
 * wrong company's logo. This index contains actual Simple Icons marks, not
 * generated illustrations. Logo availability does not affect stock or orders.
 */
export function verificationArtwork(label: string): ExplorerArtwork {
  const name = label.trim().replace(/\s+/g, " ").toLowerCase();
  const domain = Object.hasOwn(SITES, name) ? SITES[name] : undefined;
  if (domain) return { kind: "site-favicon", domain };
  const marks = index.marks as Record<string, string[]>;
  const mark = Object.hasOwn(marks, name) ? marks[name] : undefined;
  if (mark) return { kind: "simple-icon", slug: mark[0], hex: mark[1], version: index.version };
  const brands = verifiedBrands as Record<string, { slug: string }>;
  const brand = Object.hasOwn(brands, name) ? brands[name] : undefined;
  if (brand) return { kind: "verified-brand-logo", slug: brand.slug };
  return { kind: "service", name: "numbers" };
}
