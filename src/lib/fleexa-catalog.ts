import "server-only";
import { createHash } from "node:crypto";
import { isFleexaConfigured, listFleexaEmailProducts, listFleexaRentAreas, listFleexaSmsServices, type FleexaEmailProduct, type FleexaRentArea, type FleexaSmsService } from "@/lib/fleexa";
import { priceFromCost, isPriceInBand } from "@/lib/pricing";
import { safeUnitCount } from "@/lib/service-units";
import { explorerCountry, VERIFICATION_EXAMPLES, type ExplorerItem } from "@/lib/service-explorer";

export type SupplierSnapshot = {
  sms: FleexaSmsService[];
  email: FleexaEmailProduct[];
  rentals: FleexaRentArea[];
  partial: boolean;
  fetchedAt: string;
};

let cache: { expires: number; snapshot: SupplierSnapshot } | null = null;
let inFlight: Promise<SupplierSnapshot> | null = null;

/** A short-lived, process-local read cache; the shared rate limit still protects the supplier key across instances. */
export async function readSupplierSnapshot(refresh = false): Promise<SupplierSnapshot> {
  if (!isFleexaConfigured()) throw new Error("Supplier not configured");
  if (!refresh && cache && cache.expires > Date.now()) return cache.snapshot;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const [sms, email, rentals] = await Promise.allSettled([listFleexaSmsServices(), listFleexaEmailProducts(), listFleexaRentAreas()]);
    const results = [sms, email, rentals];
    if (results.every((result) => result.status === "rejected")) throw new Error("Supplier catalog unavailable");
    const snapshot: SupplierSnapshot = {
      sms: sms.status === "fulfilled" ? sms.value.slice(0, 2000) : [],
      email: email.status === "fulfilled" ? email.value.slice(0, 2000) : [],
      rentals: rentals.status === "fulfilled" ? rentals.value.slice(0, 2000) : [],
      partial: results.some((result) => result.status === "rejected"),
      fetchedAt: new Date().toISOString(),
    };
    cache = { snapshot, expires: Date.now() + 30_000 };
    return snapshot;
  })();
  try { return await inFlight; } finally { inFlight = null; }
}

function readable(value: string | null, max = 100): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  if (!result || result.length > max || /[\u0000-\u001f\u007f]/.test(result) || /fleexa/i.test(result)) return null;
  return result;
}

function matchesCountry(providerCountry: string | null, selectedCode: string): boolean {
  const country = explorerCountry(selectedCode);
  const value = readable(providerCountry)?.toLowerCase();
  if (!country || !value) return false;
  if (value === country.code || value === country.name.toLowerCase()) return true;
  // Unambiguous, commonly used alternatives, not inferred dialling codes.
  return (country.code === "gb" && value === "uk") || (country.code === "us" && (value === "usa" || value === "united states of america"));
}

function retail(cost: number | null, service: "numbers" | "email-otp"): number | null {
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 1 || cost > 50_000_000) return null;
  const price = priceFromCost(Math.ceil(cost), { service }).priceNgn;
  return Number.isSafeInteger(price) && price > 0 && isPriceInBand(price, cost) ? price : null;
}

function itemId(kind: string, providerId: string, country: string): string {
  return `supplier-${kind}-${createHash("sha256").update(`${kind}\0${providerId}\0${country}`).digest("hex").slice(0, 20)}`;
}

/**
 * Only explicitly country-matching entries are displayed. Names, retail price
 * and counts are bounded; raw responses, supplier IDs/costs and credentials
 * never reach the browser. A listing is not a promise of stock or checkout.
 */
export function supplierItemsForCountry(snapshot: SupplierSnapshot, countryCode: string): ExplorerItem[] {
  const country = explorerCountry(countryCode);
  if (!country) return [];
  const items: ExplorerItem[] = [];
  const ids = new Set<string>();
  function add(item: ExplorerItem) { if (!ids.has(item.id)) { ids.add(item.id); items.push(item); } }

  for (const entry of snapshot.sms) {
    const id = readable(entry.id, 120), name = readable(entry.name, 80);
    if (!id || !name || !matchesCountry(entry.country, country.code)) continue;
    const brand = VERIFICATION_EXAMPLES.find((item) => item.name.toLowerCase() === name.toLowerCase());
    add({
      id: itemId("sms", id, country.code), category: "verification", name, description: "SMS verification listing",
      tag: brand?.tag ?? "Other", artwork: brand ? { kind: "brand", name: brand.brand } : { kind: "service", name: "numbers" },
      source: "supplier", coverage: "catalog-country", stock: safeUnitCount(entry.stock), myUnits: null,
      price: retail(entry.priceNgn, "numbers"), action: null,
    });
  }
  for (const entry of snapshot.email) {
    const id = readable(entry.id, 120), name = readable(entry.name, 80) ?? readable(entry.domain, 80);
    if (!id || !name) continue;
    add({
      id: itemId("email", id, "global"), category: "email", name, description: "Temporary email listing", tag: "Email OTP",
      artwork: { kind: "service", name: "email-otp" }, source: "supplier", coverage: "not-country-specific",
      stock: safeUnitCount(entry.stock), myUnits: null, price: retail(entry.priceNgn, "email-otp"), action: null,
    });
  }
  for (const entry of snapshot.rentals) {
    const id = readable(entry.id, 120);
    if (!id || !matchesCountry(entry.country, country.code)) continue;
    add({
      id: itemId("rent", id, country.code), category: "numbers", name: "Number rental", description: "Rental listing",
      tag: "Rental", artwork: { kind: "service", name: "numbers" }, source: "supplier", coverage: "catalog-country",
      stock: safeUnitCount(entry.stock), myUnits: null, price: retail(entry.pricePerMonthNgn, "numbers"), action: null,
    });
  }
  return items;
}
