import { BRAND_MARKS } from "@/lib/content/brand-marks";
import { parseDigitalArtwork } from "@/lib/content/digital-artwork";
import type { ExplorerItem } from "@/lib/services/service-explorer";

/** The API is normally sanitized server-side. Still validate its JSON before
 * rendering: one malformed row must not crash or erase an otherwise useful feed. */
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const serviceArtwork = new Set(["numbers", "esim", "proxies", "email-otp", "accounts", "bulk", "scheduled", "social-promotion", "gift-cards", "subscriptions", "data", "games", "topups", "prepaid"]);
function renderableArtwork(value: unknown): boolean {
  if (!record(value)) return false;
  switch (value.kind) {
    case "brand": return typeof value.name === "string" && (Object.hasOwn(BRAND_MARKS, value.name) || value.name === "disney-plus");
    case "service": return typeof value.name === "string" && serviceArtwork.has(value.name);
    case "network": return typeof value.name === "string" && ["mtn", "airtel", "glo", "9mobile"].includes(value.name);
    case "unidentified-inbox": return true;
    case "site-favicon": return typeof value.domain === "string" && value.domain.length > 0 && value.domain.length <= 253 && !/[\u0000-\u001f\u007f]/.test(value.domain);
    case "simple-icon": return typeof value.slug === "string" && /^[a-z0-9-]+$/.test(value.slug) && typeof value.version === "string" && /^[0-9.]+$/.test(value.version) && typeof value.hex === "string" && /^[a-f0-9]{6}$/i.test(value.hex);
    case "verified-brand-logo": return typeof value.slug === "string" && /^[a-z0-9-]+$/.test(value.slug) && (value.format === undefined || value.format === "png");
    case "digital-product": return value.art === null || parseDigitalArtwork(value.art) !== null;
    default: return false;
  }
}

function count(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}
function price(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}
function optionalText(value: unknown): boolean { return value === undefined || typeof value === "string"; }
function optionalBoolean(value: unknown): boolean { return value === undefined || typeof value === "boolean"; }

function safeAction(value: unknown, item: Record<string, unknown>, country: string): ExplorerItem["action"] {
  if (!record(value) || typeof value.label !== "string" || !value.label.trim() || typeof value.href !== "string" ||
      !value.href.startsWith("/") || value.href.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value.href)) return null;
  try {
    const url = new URL(value.href, "https://catalog.invalid");
    if (url.origin !== "https://catalog.invalid" || typeof item.id !== "string" ||
        typeof item.price !== "number" || item.price <= 0 || item.stock === 0 || item.orderingPaused === true) return null;
    // Each live card must point to its own checkout, never a different offer or
    // destination. Checkout still independently rechecks price and availability.
    if (item.category === "verification") {
      if (!/^otp-[a-f0-9]{24}$/.test(item.id) || url.pathname !== `/dashboard/services/otp/${item.id}` ||
          url.searchParams.getAll("country").length !== 1 || url.searchParams.get("country") !== country) return null;
    } else if (item.category === "social") {
      if (url.pathname !== `/dashboard/services/boost/${encodeURIComponent(item.id)}`) return null;
    } else if (item.category === "esim") {
      if (url.pathname !== `/dashboard/esim/${encodeURIComponent(item.id)}`) return null;
    } else {
      // Live email and rental listings are currently browse-only.
      return null;
    }
    return { label: value.label, href: value.href };
  } catch {
    return null;
  }
}

export function readLiveExplorerItems(values: unknown[], categories: readonly string[], country: string): { items: ExplorerItem[]; incomplete: boolean } {
  const items: ExplorerItem[] = [];
  let incomplete = false;
  for (const value of values) {
    if (!record(value) || typeof value.id !== "string" || !value.id.trim() || typeof value.category !== "string" || !categories.includes(value.category) ||
        typeof value.name !== "string" || !value.name.trim() || typeof value.description !== "string" || typeof value.tag !== "string" ||
        value.source !== "live" || typeof value.coverage !== "string" || !["catalog-country", "unconfirmed", "not-country-specific"].includes(value.coverage) ||
        !renderableArtwork(value.artwork) || !count(value.stock) || !count(value.myUnits) || !price(value.price) ||
        ![value.platform, value.searchTerms, value.detail, value.giftCardEquivalenceKey].every(optionalText) ||
        ![value.priceFrom, value.orderingPaused, value.crossCategorySearch, value.allOnly].every(optionalBoolean)) {
      incomplete = true;
      continue;
    }
    const action = value.action === null ? null : safeAction(value.action, value, country);
    if (value.action !== null && !action) incomplete = true;
    items.push({ ...value, action } as ExplorerItem);
  }
  return { items, incomplete };
}
