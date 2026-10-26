import { findPlan } from "./catalog";

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

  // Calculate discount based on total quantity
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  
  if (totalQuantity >= 20) {
    result.discountPercent = 10;
  } else if (totalQuantity >= 10) {
    result.discountPercent = 5;
  }

  result.discount = Math.round(result.subtotal * (result.discountPercent / 100));
  result.total = result.subtotal - result.discount;

  return result;
}

export function getBulkDiscountMessage(quantity: number): string | null {
  if (quantity >= 20) {
    return "10% discount applied for 20+ items";
  } else if (quantity >= 10) {
    return "5% discount applied for 10+ items";
  } else if (quantity >= 5) {
    return `Add ${10 - quantity} more items for 5% discount`;
  }
  return null;
}
