import { findPlan } from "./catalog";
import { CATALOG_PRICES } from "./prices.generated";

/**
 * The most units one checkout will buy from the supplier.
 *
 * Shared by the route (which enforces it) and the form (which warns before a
 * basket is built), so the two cannot drift.
 */
export const MAX_BULK_UNITS = 20;

export interface BulkOrderItem {
  productSlug: string;
  quantity: number;
}

export interface BulkOrderResult {
  items: {
    productSlug: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }[];
  subtotal: number;
  discount: number;
  discountPercent: number;
  total: number;
}

export function calculateBulkOrder(items: BulkOrderItem[]): BulkOrderResult {
  const result: BulkOrderResult = {
    items: [],
    subtotal: 0,
    discount: 0,
    discountPercent: 0,
    total: 0,
  };

  for (const item of items) {
    const plan = typeof item?.productSlug === "string" ? findPlan(item.productSlug) : undefined;
    if (!plan || !Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      throw new Error("Invalid bulk-order item");
    }

    const subtotal = plan.price * item.quantity;
    if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(result.subtotal + subtotal)) {
      throw new Error("Bulk-order total is too large");
    }

    result.items.push({
      productSlug: item.productSlug,
      productName: plan.name,
      quantity: item.quantity,
      unitPrice: plan.price,
      subtotal,
    });

    result.subtotal += subtotal;
  }

  // Discount is a courtesy, not a loss-leader: the basket may only give away as
  // much headroom as its thinnest-margin line can afford (30% floor).
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  if (!Number.isSafeInteger(totalQuantity)) throw new Error("Bulk-order quantity is too large");

  let tierPercent = 0;
  if (totalQuantity >= 20) {
    tierPercent = 10;
  } else if (totalQuantity >= 10) {
    tierPercent = 5;
  }

  const headroom = result.items.reduce((lowest, item) => {
    const generated = CATALOG_PRICES[item.productSlug];
    const allowed = generated ? generated.maxDiscountPercent : 0;
    return Math.min(lowest, allowed);
  }, tierPercent);

  result.discountPercent = Math.min(tierPercent, Math.max(0, headroom));
  result.discount = Math.round(result.subtotal * (result.discountPercent / 100));
  result.total = result.subtotal - result.discount;

  return result;
}

// Allocate the basket discount to individual simulated orders so their amounts
// add up exactly to the wallet deduction, including whole-naira rounding.
export function expandBulkOrder(result: BulkOrderResult) {
  if (!Number.isSafeInteger(result.subtotal) || !Number.isSafeInteger(result.discount) || result.subtotal <= 0 || result.discount < 0 || result.discount > result.subtotal || result.total !== result.subtotal - result.discount) {
    throw new Error("Invalid bulk-order total");
  }
  const units = result.items.flatMap((item) => Array.from({ length: item.quantity }, () => {
    const numerator = BigInt(result.discount) * BigInt(item.unitPrice);
    return {
      productSlug: item.productSlug,
      productName: item.productName,
      amount: item.unitPrice - Number(numerator / BigInt(result.subtotal)),
      remainder: numerator % BigInt(result.subtotal),
    };
  }));
  const remaining = units.reduce((sum, item) => sum + item.amount, 0) - result.total;
  const ranked = [...units].sort((a, b) => a.remainder === b.remainder ? 0 : a.remainder > b.remainder ? -1 : 1);
  for (let i = 0; i < remaining; i++) ranked[i].amount--;
  return units.map(({ remainder: _remainder, ...item }) => item);
}

export function getBulkDiscountMessage(quantity: number, appliedPercent?: number): string | null {
  const tier = quantity >= 20 ? 10 : quantity >= 10 ? 5 : 0;
  const capped =
    tier > 0 && appliedPercent !== undefined && appliedPercent < tier
      ? ` — ${appliedPercent}% on this basket to keep every line profitable`
      : "";

  if (quantity >= 20) {
    return `10% discount for 20+ items${capped}`;
  } else if (quantity >= 10) {
    return `5% discount for 10+ items${capped}`;
  } else if (quantity >= 5) {
    return `Add ${10 - quantity} more items for a 5% discount`;
  }
  return null;
}
