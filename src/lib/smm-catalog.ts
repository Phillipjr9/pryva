import "server-only";
import { createHash } from "node:crypto";
import {
  getSmmBalance,
  isSmmPanelConfigured,
  listSmmServices,
  smmPanelApiUrlSetting,
  type SmmService,
} from "@/lib/smm-panel";
import { PROMOTION_EXAMPLES, type ExplorerItem } from "@/lib/service-explorer";

export type BoostSnapshot = {
  services: SmmService[];
  /**
   * The panel's own billing currency, read from its balance response rather than
   * assumed. Null when the panel did not report one. Retail pricing is not
   * derived here: it depends on whether the panel bills NGN or USD, which is a
   * decision that has not been made, so every listing is priced null.
   */
  currency: string | null;
  balance: number | null;
  partial: boolean;
  fetchedAt: string;
};

let cache: { expires: number; snapshot: BoostSnapshot } | null = null;
let inFlight: Promise<BoostSnapshot> | null = null;

/** A short-lived, process-local read cache; the shared rate limit still protects the panel key across instances. */
export async function readBoostSnapshot(refresh = false): Promise<BoostSnapshot> {
  if (!isSmmPanelConfigured()) throw new Error("Boosting supplier not configured");
  if (!refresh && cache && cache.expires > Date.now()) return cache.snapshot;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const [services, balance] = await Promise.allSettled([listSmmServices(), getSmmBalance()]);
    // Without the service list there is nothing to display, so that failure is
    // fatal. Balance only supplies the billing currency, so it degrades instead.
    if (services.status === "rejected") throw new Error("Boosting catalog unavailable");
    const settled = balance.status === "fulfilled" ? balance.value : null;
    const snapshot: BoostSnapshot = {
      services: services.value.slice(0, 2000),
      currency: settled?.currency ?? null,
      balance: settled?.balance ?? null,
      partial: balance.status === "rejected",
      fetchedAt: new Date().toISOString(),
    };
    cache = { snapshot, expires: Date.now() + 30_000 };
    return snapshot;
  })();
  try { return await inFlight; } finally { inFlight = null; }
}

/* ------------------------------------------------------------------ */
/* Customer-facing sanitizing                                           */
/* ------------------------------------------------------------------ */

/**
 * Words that would reveal the sourcing model. Pryva sells these as its own
 * services, so neither the panel's name nor the fact that a panel is involved
 * may reach a customer.
 */
const PROVENANCE_WORDS = ["reseller", "panel", "wholesale", "supplier", "provider", "smm", "api"];

/** Domain tokens of the configured panel, so its brand cannot leak via a name. */
function panelTokens(): string[] {
  const raw = smmPanelApiUrlSetting();
  if (!raw) return [];
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    const generic = new Set(["com", "net", "org", "app", "dev", "io", "co", "uk", "ng", "www", "api", "panel", "smm"]);
    return host.split(".").filter((part) => part.length >= 3 && !generic.has(part));
  } catch {
    return [];
  }
}

function revealsProvenance(text: string): boolean {
  const lowered = text.toLowerCase();
  if (PROVENANCE_WORDS.some((word) => new RegExp(`\\b${word}\\b`).test(lowered))) return true;
  return panelTokens().some((token) => lowered.includes(token));
}

/**
 * Panels decorate names with emoji, newlines and marketing copy. Whitespace is
 * collapsed, pictographs dropped, control characters rejected and the result
 * bounded. Returns null when the text is unusable or would reveal provenance,
 * so the caller can fall back to a synthetic name instead of dropping the
 * listing — coverage must not depend on how a panel formats its catalog.
 */
function readable(value: string | null, max = 70): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[\u{FE00}-\u{FE0F}\u{200D}]/gu, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!collapsed || collapsed.length > max) return null;
  if (revealsProvenance(collapsed)) return null;
  return collapsed;
}

const BOOST_TAGS: Array<{ tag: string; pattern: RegExp }> = [
  { tag: "Subscribers", pattern: /subscriber/i },
  { tag: "Views", pattern: /\bviews?\b|\bplays?\b|watch time/i },
  { tag: "Likes", pattern: /\blikes?\b/i },
  { tag: "Followers", pattern: /follower|\bfans\b|\bmembers\b/i },
];

/** Panel `type` values that describe nothing a customer would understand. */
const UNINFORMATIVE_TYPES = ["default", "package", "standard", "normal", "regular"];

function boostTag(service: SmmService, displayName: string): string {
  const haystack = `${service.name ?? ""} ${service.category ?? ""} ${displayName}`;
  for (const candidate of BOOST_TAGS) {
    if (candidate.pattern.test(haystack)) return candidate.tag;
  }
  // Unmatched services (comments, shares, saves, poll answers) keep their own
  // label. The four chips above still filter the common cases, and "All" shows
  // everything, so no listing is hidden by falling outside the known tags.
  const fromCategory = readable(service.category, 24);
  if (fromCategory) return fromCategory;
  const fromType = readable(service.type, 24);
  return fromType && !UNINFORMATIVE_TYPES.includes(fromType.toLowerCase()) ? fromType : "Other";
}

function matchesPlatform(text: string, platform: string): boolean {
  const escaped = platform.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Single-letter platforms such as X need separators, or they match anywhere.
  const pattern = platform.length === 1
    ? new RegExp(`(?:^|[\\s|/,\\-])${escaped}(?:$|[\\s|/,\\-])`, "i")
    : new RegExp(`\\b${escaped}\\b`, "i");
  return pattern.test(text);
}

/** Panel service identifiers are hashed; the raw id never reaches the browser. */
function itemId(providerId: string): string {
  return `live-boost-${createHash("sha256").update(`boost\0${providerId}`).digest("hex").slice(0, 20)}`;
}

/**
 * Boosting targets a profile or post URL rather than a country, so listings are
 * not country-specific and are shown for every selection. Stock is null because
 * panels report a per-order maximum, not available inventory, and the two must
 * not be confused. Price and action are null by design: retail pricing is not
 * decided and ordering is not wired, so the hub renders these as read-only
 * listings rather than implying a checkout that does not exist.
 */
export function boostItems(snapshot: BoostSnapshot): ExplorerItem[] {
  const items: ExplorerItem[] = [];
  const ids = new Set<string>();

  for (const service of snapshot.services) {
    const platform = PROMOTION_EXAMPLES.find((candidate) =>
      matchesPlatform(`${service.name ?? ""} ${service.category ?? ""}`, candidate.name));
    const cleanName = readable(service.name);
    const tag = boostTag(service, cleanName ?? "");
    // A category is a grouping label, not a product name: "Instagram" on its own
    // does not tell a customer what they would be buying. So when the panel's own
    // name is unusable or would reveal provenance, synthesize one from the
    // platform and the derived type rather than falling back to the category.
    // Coverage never depends on how a panel words its catalog.
    const name = cleanName ?? `${platform?.name ?? "Social"} ${tag.toLowerCase()}`;
    const id = itemId(service.id);
    if (ids.has(id)) continue;
    ids.add(id);

    items.push({
      id,
      category: "social",
      name,
      description: "Social promotion",
      tag,
      platform: platform?.name,
      artwork: platform ? { kind: "brand", name: platform.brand } : { kind: "service", name: "bulk" },
      source: "live",
      coverage: "not-country-specific",
      stock: null,
      myUnits: null,
      price: null,
      action: null,
    });
  }
  return items;
}
