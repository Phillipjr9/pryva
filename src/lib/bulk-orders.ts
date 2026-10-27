import { findPlan } from "./catalog";
import { CATALOG_PRICES } from "./prices.generated";

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
    const plan = findPlan(item.productSlug);
    if (!plan) continue;

    const subtotal = plan.price * item.quantity;
    
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
