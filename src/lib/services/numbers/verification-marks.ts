import "server-only";
import index from "./verification-mark-index.json";
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
  // ElevenLabs' student bundle: https://aistudentpack.com/
  "ai student pack": "aistudentpack.com",
  // The sports-betting app advertises phone verification for its referral
  // programme; another Action Network exists, so keep this an exact match.
  // https://www.maximizingmoney.com/referral-programs/action-network-sports-betting-app/
  "action network": "actionnetwork.com",
};

/** App Store artwork is linked by the exact known app ID, not searched on a
 * customer's request. The provider calls AHEALTH by its former name as well.
 * https://itunes.apple.com/lookup?id=1638253339
 * https://itunes.apple.com/lookup?id=6754340820
 */
const APP_STORE_MARKS: Readonly<Record<string, "ahealth" | "airperks">> = {
  "ahealth formerly moneywalk": "ahealth",
  "airperks": "airperks",
};

/** Match only complete names. Unknown or ambiguous names must not wear the
 * wrong company's logo. This index contains actual Simple Icons marks, not
 * generated illustrations. Logo availability does not affect stock or orders.
 */
export function verificationArtwork(label: string): ExplorerArtwork {
  const name = label.trim().replace(/\s+/g, " ").toLowerCase();
  const appMark = Object.hasOwn(APP_STORE_MARKS, name) ? APP_STORE_MARKS[name] : undefined;
  if (appMark) return { kind: "app-store-icon", name: appMark };
  const domain = Object.hasOwn(SITES, name) ? SITES[name] : undefined;
  if (domain) return { kind: "site-favicon", domain };
  const marks = index.marks as Record<string, string[]>;
  const mark = Object.hasOwn(marks, name) ? marks[name] : undefined;
  if (mark) return { kind: "simple-icon", slug: mark[0], hex: mark[1], version: index.version };
  return { kind: "service", name: "numbers" };
}
