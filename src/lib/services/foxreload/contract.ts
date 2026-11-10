/**
 * FoxReload's order contract, independent of the legacy gift-card adapter.
 * A valid result is not evidence that a charge is safe: callers must also
 * implement wallet claims, quote confirmation and provider reconciliation.
 */
export const DELIVERY_TYPES = ["code", "esim", "direct_topup", "login_topup", "banking_card", "banking_card_topup"] as const;
export type DeliveryType = typeof DELIVERY_TYPES[number];
export type NoteValue = string | number | boolean | null;
export type NoteType = "string" | "integer" | "number" | "email" | "select";
export type NoteOption = { value: string; label: string };
export type Product = {
  id: string; name: string; currency: string | null; unitPrice: string | null;
  deliveryType: DeliveryType | null; quantity: number | null;
  // Optional indicates malformed/missing attributes, distinct from an explicit
  // absence of a region within a valid attributes object.
  countryCode?: string | null; marketRegion?: string | null;
  minQuantity: number | null; maxQuantity: number | null;
  requiredNoteFields: string[] | null;
  noteFieldTypes: Record<string, NoteType> | null;
  noteFieldOptions: Record<string, NoteOption[]> | null;
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function safeText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}
function positiveInt(value: unknown, max = 1_000_000): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= max ? value : null;
}
/** Only exact, nonnegative decimal strings; never turn missing/invalid into zero. */
export function decimalUnits(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(10_000) + BigInt(fraction.padEnd(4, "0"));
}
export function formatDecimalUnits(units: bigint): string {
  if (units < BigInt(0)) throw new Error("Negative amount");
  return `${units / BigInt(10_000)}.${String(units % BigInt(10_000)).padStart(4, "0")}`;
}

/** Parse explicit fields only; unknown delivery and missing note metadata stay unknown. */
export function parseProduct(raw: unknown): Product | null {
  const value = object(raw);
  if (!value || !safeText(value.id, 64) || !safeText(value.name, 256)) return null;
  // A malformed bound must not become an unbounded offer. Missing optional
  // maximum is distinct from an invalid value; the API allows null maximum.
  if ((value.orderMinQuantity !== undefined && positiveInt(value.orderMinQuantity) === null) ||
      (value.orderMaxQuantity !== undefined && value.orderMaxQuantity !== null && positiveInt(value.orderMaxQuantity) === null) ||
      (value.quantity !== undefined && (typeof value.quantity !== "number" || !Number.isSafeInteger(value.quantity) || value.quantity < 0))) return null;
  const delivery = typeof value.deliveryType === "string" && DELIVERY_TYPES.includes(value.deliveryType as DeliveryType)
    ? value.deliveryType as DeliveryType : null;
  const required = Array.isArray(value.requiredNoteFields) && value.requiredNoteFields.length <= 10 &&
    value.requiredNoteFields.every((field: unknown) => safeText(field, 64)) &&
    new Set(value.requiredNoteFields).size === value.requiredNoteFields.length ? value.requiredNoteFields as string[] : null;
  let types: Record<string, NoteType> | null = null;
  const rawTypes = object(value.noteFieldTypes);
  if (rawTypes && Object.keys(rawTypes).length <= 10 && Object.entries(rawTypes).every(([key, type]) => safeText(key, 64) && typeof type === "string" && ["string", "integer", "number", "email", "select"].includes(type))) {
    types = Object.fromEntries(Object.entries(rawTypes)) as Record<string, NoteType>;
  }
  let options: Record<string, NoteOption[]> | null = null;
  const rawOptions = object(value.noteFieldOptions);
  if (rawOptions && Object.keys(rawOptions).length <= 10 && Object.entries(rawOptions).every(([key, entries]) => safeText(key, 64) && Array.isArray(entries) && entries.length <= 100 && entries.every((entry) => {
    const item = object(entry); return item && safeText(item.value, 128) && safeText(item.label, 128);
  }))) {
    options = Object.fromEntries(Object.entries(rawOptions).map(([key, entries]) => [key, (entries as Record<string, string>[]).map((item) => ({ value: item.value, label: item.label }))]));
  }
  const attributes = object(value.attributes);
  const marketValue = (field: string): string | null | undefined => {
    if (!attributes) return undefined;
    const item = attributes[field];
    if (item === null || item === undefined) return null;
    return safeText(item, 64) ? item : undefined;
  };
  return {
    id: value.id, name: value.name,
    countryCode: marketValue("country_code"), marketRegion: marketValue("region"),
    currency: typeof value.currency === "string" && /^[a-z]{3}$/.test(value.currency) ? value.currency : null,
    unitPrice: decimalUnits(value.price) !== null ? value.price as string : null,
    deliveryType: delivery,
    quantity: typeof value.quantity === "number" && Number.isSafeInteger(value.quantity) && value.quantity >= 0 ? value.quantity : null,
    minQuantity: positiveInt(value.orderMinQuantity), maxQuantity: positiveInt(value.orderMaxQuantity),
    requiredNoteFields: required, noteFieldTypes: types, noteFieldOptions: options,
  };
}

/** Build a wholesale item from fresh server-side data. Card issuance has a
 * separate initial-amount charge and top-ups require ownership checks; neither
 * should use this generic flow.
 * This alone is not a wallet quote, order claim, or stock guarantee. */
export function buildOrderItem(product: Product, quantity: number, note: Record<string, NoteValue>): {
  itemId: string; quantity: number; totalPrice: string; note?: Record<string, NoteValue>;
} | null {
  const price = decimalUnits(product.unitPrice);
  if (!product.deliveryType || (product.deliveryType === "banking_card" || product.deliveryType === "banking_card_topup") || !product.currency || price === null || price <= BigInt(0) || !product.requiredNoteFields || !product.noteFieldTypes) return null;
  if (!positiveInt(quantity) || (product.minQuantity !== null && quantity < product.minQuantity) || (product.maxQuantity !== null && quantity > product.maxQuantity)) return null;
  const notes = object(note);
  if (!notes || Object.keys(notes).length > 10 || Object.keys(notes).some((key) => !safeText(key, 64) || !product.requiredNoteFields!.includes(key))) return null;
  for (const field of product.requiredNoteFields) {
    const input = notes[field];
    const type = product.noteFieldTypes[field];
    if (!type || input === undefined || input === null) return null;
    if ((type === "string" || type === "email" || type === "select") && (!safeText(input, 128) || !input.trim())) return null;
    if (type === "email" && (typeof input !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input))) return null;
    if (type === "integer" && (typeof input !== "number" || !Number.isSafeInteger(input))) return null;
    if (type === "number" && (typeof input !== "number" || !Number.isFinite(input) || Math.abs(input) > 1e18)) return null;
    if (type === "select" && !product.noteFieldOptions?.[field]?.some((option) => option.value === input)) return null;
  }
  const total = price * BigInt(quantity);
  // FoxReload's public input permits at most 16 digits including 4 decimals.
  if (total > BigInt("9999999999999999")) return null;
  return { itemId: product.id, quantity, totalPrice: formatDecimalUnits(total), ...(Object.keys(notes).length ? { note: { ...note } } : {}) };
}
