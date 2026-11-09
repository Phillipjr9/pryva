import "server-only";
import { createHash, createHmac } from "node:crypto";
import { buildOrderItem, decimalUnits, formatDecimalUnits, type Product } from "./contract";

// This slice accepts only non-secret account identifiers. Passwords, sessions,
// payment cards and other credentials need a separate security design.
const ALLOWED_KEYS = new Set(["username", "login", "account_id", "user_id", "userid", "player_id", "playerid", "game_id", "gameid", "server", "server_id", "zone", "zone_id", "uid", "email", "phone", "phone_number"]);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
export type TopupField = { key: string; label: string };
export type TopupOffer = { id: string; name: string; region: string; terms: string; countryCode: string | null; marketRegion: string | null; min: number; max: number; fields: TopupField[] };
export function approvedTopupOffers(env: Record<string, string | undefined> = process.env): TopupOffer[] {
  if (!env.FOXRELOAD_TOPUP_OFFERS || env.FOXRELOAD_TOPUP_OFFERS.length > 100_000) return [];
  try {
    const raw: unknown = JSON.parse(env.FOXRELOAD_TOPUP_OFFERS);
    if (!Array.isArray(raw) || raw.length > 500) return [];
    const result: TopupOffer[] = [], ids = new Set<string>();
    for (const value of raw) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const { id, name, region, terms, countryCode, marketRegion, min, max, fields } = value as Record<string, unknown>;
      if (typeof id !== "string" || !/^product_[a-z0-9]{26}$/.test(id) || ids.has(id) || !text(name, 100) || !text(region, 80) || !text(terms, 500) ||
          (countryCode !== null && !text(countryCode, 64)) || (marketRegion !== null && !text(marketRegion, 64)) ||
          !Number.isSafeInteger(min) || !Number.isSafeInteger(max) || (min as number) < 1 || (max as number) > 1_000_000 || (min as number) > (max as number) ||
          !Array.isArray(fields) || fields.length < 1 || fields.length > 8) return [];
      const cleaned: TopupField[] = [], keys = new Set<string>();
      for (const field of fields) {
        if (!field || typeof field !== "object" || Array.isArray(field)) return [];
        const { key, label } = field as Record<string, unknown>;
        if (typeof key !== "string" || !ALLOWED_KEYS.has(key) || keys.has(key) || !text(label, 80)) return [];
        keys.add(key); cleaned.push({ key, label });
      }
      ids.add(id); result.push({ id, name, region, terms, countryCode, marketRegion, min: min as number, max: max as number, fields: cleaned });
    }
    return result;
  } catch { return []; }
}
export function publicTopupId(id: string) { return `digital-${createHash("sha256").update(id).digest("hex").slice(0, 24)}`; }
export function topupFingerprint(offer: TopupOffer) { return `topup:${createHash("sha256").update(JSON.stringify(offer)).digest("hex")}`; }
/** Require exactly the reviewed fields and explicit/known string types. */
export function prepareTopup(product: Product, offer: TopupOffer): Product | null {
  if (product.id !== offer.id || product.name !== offer.name || product.currency !== "usd" || product.deliveryType !== "direct_topup" ||
      product.countryCode === undefined || product.marketRegion === undefined || product.countryCode !== offer.countryCode || product.marketRegion !== offer.marketRegion ||
      product.minQuantity === null || offer.min < product.minQuantity || (product.maxQuantity !== null && offer.max > product.maxQuantity) ||
      product.quantity === null || !product.requiredNoteFields || !product.noteFieldTypes || !product.noteFieldOptions ||
      product.requiredNoteFields.length !== offer.fields.length) return null;
  const fields = offer.fields.map((field) => field.key);
  if (product.requiredNoteFields.some((key) => !fields.includes(key))) return null;
  for (const key of fields) {
    const type = product.noteFieldTypes[key];
    if ((type !== undefined && type !== "string") || product.noteFieldOptions[key] !== undefined) return null;
  }
  return { ...product, noteFieldTypes: { ...product.noteFieldTypes, ...Object.fromEntries(fields.map((key) => [key, "string" as const])) } };
}
export function topupPrice(product: Product, offer: TopupOffer, quantity: number, env: Record<string, string | undefined> = process.env): { amount: number; wholesaleTotal: string } | null {
  const prepared = prepareTopup(product, offer);
  if (!prepared || !Number.isSafeInteger(quantity) || quantity < offer.min || quantity > offer.max || prepared.quantity === null || prepared.quantity < quantity) return null;
  const placeholder = Object.fromEntries(offer.fields.map(({ key }) => [key, "example"]));
  const item = buildOrderItem(prepared, quantity, placeholder);
  const wholesale = item && decimalUnits(item.totalPrice), fx = decimalUnits(env.FOXRELOAD_USD_NGN_RATE?.trim());
  if (wholesale === null || wholesale === undefined || wholesale <= BigInt(0) || fx === null || fx <= BigInt(0)) return null;
  const denominator = BigInt(10_000) * BigInt(10_000) * BigInt(100), numerator = wholesale * fx * BigInt(140);
  const amount = (numerator + denominator - BigInt(1)) / denominator;
  if (amount < BigInt(1) || amount > BigInt(2_147_483_647)) return null;
  return { amount: Number(amount), wholesaleTotal: formatDecimalUnits(wholesale) };
}
export function normalizeTopupNote(input: unknown, fields?: TopupField[]): Record<string, string> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const entries = Object.entries(input as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length < 1 || entries.length > 8 || (fields && (entries.length !== fields.length || entries.some(([key]) => !fields.some((field) => field.key === key))))) return null;
  const result: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!ALLOWED_KEYS.has(key) || typeof value !== "string" || !text(value.trim(), 128)) return null;
    result[key] = value.trim();
  }
  return result;
}
export function topupIntent(userId: string, quoteId: string, note: Record<string, string>, secret = process.env.FOXRELOAD_INTENT_SECRET): string | null {
  if (!secret || secret.length < 32 || secret.length > 1024) return null;
  const canonical = normalizeTopupNote(note);
  if (!canonical) return null;
  return `topup:${createHmac("sha256", secret).update(JSON.stringify([userId, quoteId.toLowerCase(), canonical])).digest("hex")}`;
}
