import type { ExplorerItem } from "@/lib/service-explorer";

/** Number of simulated inboxes/codes in a catalog bundle. */
export function demoPlanUnits(slug: string): number {
  return ({ "vn-otp-5": 5, "email-bundle": 5, "email-team": 20 } as Record<string, number>)[slug] ?? 1;
}

/** Fictional prices and inventory used only by the in-memory demo. */
export function demoServiceTerms(item: ExplorerItem): { price: number; units: number; stock: number } | null {
  if (item.source === "example") {
    return item.category === "verification"
      ? { price: 750, units: 1, stock: 250 }
      : item.category === "social" ? { price: 1200, units: 100, stock: 5000 } : null;
  }
  if (item.id.startsWith("data-") && item.category === "data" && item.price !== null) return { price: item.price, units: 1, stock: 250 };
  if (!item.id.startsWith("plan-") || item.price === null) return null;
  return { price: item.price, units: demoPlanUnits(item.id.slice(5)), stock: 250 };
}

/** A rental is one active unit, not a single-use verification credit. */
export function isDemoNumberRental(order: { provider?: unknown; service?: unknown; productSlug?: unknown; demoItemId?: unknown }): boolean {
  if (order.provider !== "simulated" || order.service !== "numbers") return false;
  const itemId = typeof order.demoItemId === "string" ? order.demoItemId : order.productSlug;
  return typeof itemId === "string" && (itemId.startsWith("plan-rent-") || itemId.startsWith("rent-"));
}

export type DemoInventory = Record<string, { stock: number; owned: number }>;
