import type { ExplorerItem } from "@/lib/services/service-explorer";
import { namedDigitalProduct } from "@/lib/services/digital-product-names";
import type { QuickShortcut } from "@/components/QuickShortcuts";

const DIGITAL_CATEGORIES = new Set(["subscriptions", "games", "topups", "gift-cards", "prepaid"]);
const POPULAR = ["facebook", "instagram", "tiktok", "x", "snapchat", "reddit", "discord", "youtube", "telegram", "whatsapp", "signal", "spotify", "netflix"];

function shortcut(label: string): QuickShortcut | null {
  const clean = label.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 160) return null;
  const lower = clean.toLowerCase();
  if (["x", "twitter", "x / twitter", "x (twitter)"].includes(lower)) return { key: "x", label: "X / Twitter" };
  return { key: lower, label: clean };
}

/**
 * Derive choices from existing listings, never from a catalogue of examples.
 * Named OTP and social offers use the supplier's actual app/platform. Digital
 * products can have a separately reviewed platform, an explicit name, or their
 * full product title. Artwork is cosmetic and is not evidence of identity.
 */
export function shortcutForExplorerItem(item: ExplorerItem): QuickShortcut | null {
  if (typeof item.name !== "string") return null;
  if (item.category === "verification") {
    if (item.source !== "live" || item.coverage !== "catalog-country" || item.name.trim().toLowerCase() === "verification number") return null;
    return shortcut(item.name);
  }
  if (item.category === "social") {
    if (item.source !== "live" || typeof item.platform !== "string" || item.platform.trim().toLowerCase() === "other platforms") return null;
    return shortcut(item.platform);
  }
  if (item.category === "email") return item.source === "live" ? shortcut(item.name) : null;
  if (!DIGITAL_CATEGORIES.has(item.category) && !(item.category === "tools" && item.allOnly && item.artwork?.kind === "digital-product")) return null;
  if (item.source !== "catalog") return null;

  if (typeof item.platform === "string" && item.platform.trim()) return shortcut(item.platform);
  // "Steam Wallet Partner Gift Card" is not automatically a Steam card.
  const gift = item.name.trim().match(/^(.{2,80}?)\s+gift\s*(?:card|voucher|code)\b/i);
  if (gift) return shortcut(gift[1]);
  return shortcut(namedDigitalProduct(item.name) ?? item.name);
}

/** Common names first, then every other reported choice alphabetically. */
export function explorerShortcuts(items: readonly ExplorerItem[]): QuickShortcut[] {
  const choices = new Map<string, QuickShortcut>();
  for (const item of items) {
    const option = shortcutForExplorerItem(item);
    if (option && !choices.has(option.key)) choices.set(option.key, option);
  }
  return [...choices.values()].sort((a, b) => {
    const rankA = POPULAR.indexOf(a.key), rankB = POPULAR.indexOf(b.key);
    return (rankA < 0 ? POPULAR.length : rankA) - (rankB < 0 ? POPULAR.length : rankB) || a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });
  });
}
