import "server-only";

import { decimalUnits, formatDecimalUnits, type Product, buildOrderItem } from "./contract";

// This is the product identity in the official API example. Check every field
// against a fresh supplier response; an example is not proof of account access.
export const TELEGRAM_STARS_PRODUCT = "product_01kj6xhpn3e29bcw1n69p5mwc5";

export function telegramUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{5,32}$/.test(username) ? username : null;
}

/**
 * The documented one-Star SKU explicitly takes a Telegram username, even when
 * the live product's optional noteFieldTypes object is empty. This fallback is
 * scoped to that exact product and contract; never infer a type for other SKUs.
 */
export function prepareStarsProduct(product: Product): Product | null {
  const name = product.name.trim().toLowerCase();
  if (product.id !== TELEGRAM_STARS_PRODUCT || (name !== "telegram stars" && name !== "telegram stars 1") ||
      product.currency !== "usd" || product.deliveryType !== "direct_topup" ||
      product.requiredNoteFields?.length !== 1 || product.requiredNoteFields[0] !== "username" ||
      !product.noteFieldTypes ||
      (product.noteFieldTypes.username !== undefined && product.noteFieldTypes.username !== "string") ||
      (product.noteFieldTypes.username === undefined && product.noteFieldOptions?.username !== undefined)) return null;
  return { ...product, noteFieldTypes: { ...product.noteFieldTypes, username: "string" } };
}

/** Exact arithmetic: wholesale USD × configured NGN/USD × 40% markup, ceil. */
export function priceStars(product: Product, quantity: number, env: Record<string, string | undefined> = process.env): { amount: number; wholesaleTotal: string } | null {
  const prepared = prepareStarsProduct(product);
  if (!prepared || prepared.quantity === null || prepared.quantity < quantity ||
      prepared.minQuantity === null || !Number.isSafeInteger(quantity)) return null;
  const item = buildOrderItem(prepared, quantity, { username: "example_user" });
  if (!item) return null;
  const wholesale = decimalUnits(item.totalPrice);
  const fx = decimalUnits(env.FOXRELOAD_USD_NGN_RATE?.trim());
  if (wholesale === null || wholesale <= BigInt(0) || fx === null || fx <= BigInt(0)) return null;
  // Both decimals are scaled by 10,000. Use integer division rounded upward.
  const numerator = wholesale * fx * BigInt(140);
  const denominator = BigInt(10_000) * BigInt(10_000) * BigInt(100);
  const total = (numerator + denominator - BigInt(1)) / denominator;
  if (total < BigInt(1) || total > BigInt(2_147_483_647)) return null;
  return { amount: Number(total), wholesaleTotal: formatDecimalUnits(wholesale) };
}
