import "server-only";
import { createHash } from "node:crypto";
import { buildOrderItem, decimalUnits, formatDecimalUnits, type Product } from "./contract";

// Only individually reviewed, region-specific travel eSIM SKUs may be
// offered. This configuration is deliberately empty until an operator has
// checked the supplier's actual offer, redemption terms, and account access.
export type EsimOffer = { id: string; name: string; region: string; terms: string; countryCode: string | null; marketRegion: string | null };
const safeText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
export function approvedEsimOffers(env: Record<string, string | undefined> = process.env): EsimOffer[] {
  if (!env.FOXRELOAD_ESIM_OFFERS || env.FOXRELOAD_ESIM_OFFERS.length > 100_000) return [];
  try {
    const rows: unknown = JSON.parse(env.FOXRELOAD_ESIM_OFFERS);
    if (!Array.isArray(rows) || rows.length > 500) return [];
    const result: EsimOffer[] = [];
    const ids = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) return [];
      const { id, name, region, terms, countryCode, marketRegion } = row as Record<string, unknown>;
      if (typeof id !== "string" || !/^product_[a-z0-9]{26}$/.test(id) || !safeText(name, 100) || !safeText(region, 80) || !safeText(terms, 500) || (countryCode !== null && !safeText(countryCode, 64)) || (marketRegion !== null && !safeText(marketRegion, 64)) || ids.has(id)) return [];
      ids.add(id); result.push({ id, name, region, terms, countryCode, marketRegion });
    }
    return result;
  } catch { return []; }
}
export function publicEsimId(id: string): string {
  return `digital-${createHash("sha256").update(id).digest("hex").slice(0, 24)}`;
}
export function esimOfferFingerprint(offer: EsimOffer): string {
  return `esim:${createHash("sha256").update(JSON.stringify([offer.id, offer.name, offer.region, offer.terms, offer.countryCode, offer.marketRegion])).digest("hex")}`;
}
export function priceEsim(product: Product, offer: EsimOffer, env: Record<string, string | undefined> = process.env): { amount: number; wholesaleTotal: string } | null {
  if (product.id !== offer.id || product.name !== offer.name || product.currency !== "usd" || product.deliveryType !== "esim" ||
      product.countryCode === undefined || product.marketRegion === undefined || product.countryCode !== offer.countryCode || product.marketRegion !== offer.marketRegion ||
      product.quantity === null || product.quantity < 1 || product.minQuantity === null ||
      !product.requiredNoteFields || product.requiredNoteFields.length !== 0 || !product.noteFieldTypes) return null;
  const item = buildOrderItem(product, 1, {});
  if (!item) return null;
  const wholesale = decimalUnits(item.totalPrice), fx = decimalUnits(env.FOXRELOAD_USD_NGN_RATE?.trim());
  if (wholesale === null || wholesale <= BigInt(0) || fx === null || fx <= BigInt(0)) return null;
  const denominator = BigInt(10_000) * BigInt(10_000) * BigInt(100);
  const numerator = wholesale * fx * BigInt(140);
  const amount = (numerator + denominator - BigInt(1)) / denominator;
  if (amount < BigInt(1) || amount > BigInt(2_147_483_647)) return null;
  return { amount: Number(amount), wholesaleTotal: formatDecimalUnits(wholesale) };
}
