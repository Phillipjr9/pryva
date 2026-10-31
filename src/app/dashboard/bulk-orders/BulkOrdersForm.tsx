"use client";

import { useState } from "react";
import { plans, formatNaira, findPlan } from "@/lib/catalog";
import { calculateBulkOrder, getBulkDiscountMessage, type BulkOrderItem } from "@/lib/bulk-orders";
import type { PublicUser } from "@/lib/auth";

interface BulkOrdersFormProps {
  user: PublicUser;
  /** Plans the server will actually buy; anything else is refused at checkout. */
  sellableSlugs: string[];
  /** The per-checkout ceiling, shared with the route. */
  maxUnits: number;
}

export function BulkOrdersForm({ user, sellableSlugs, maxUnits }: BulkOrdersFormProps) {
  const [items, setItems] = useState<BulkOrderItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const sellable = new Set(sellableSlugs);
  const allPlans = plans.filter((p) => sellable.has(p.slug));

  function addItem(productSlug: string) {
    if (totalQuantity >= maxUnits) { setError(`A basket can contain at most ${maxUnits} items.`); return; }
    setError(null);
    setSuccessMessage(null);
    const existing = items.find((item) => item.productSlug === productSlug);
    if (existing) {
      setItems(items.map((item) =>
        item.productSlug === productSlug ? { ...item, quantity: item.quantity + 1 } : item
      ));
    } else {
      setItems([...items, { productSlug, quantity: 1 }]);
    }
  }

  function updateQuantity(productSlug: string, quantity: number) {
    const current = items.find((item) => item.productSlug === productSlug)?.quantity ?? 0;
    if (totalQuantity - current + quantity > maxUnits) { setError(`A basket can contain at most ${maxUnits} items.`); return; }
    setError(null);
    setSuccessMessage(null);
    if (quantity <= 0) {
      setItems(items.filter((item) => item.productSlug !== productSlug));
    } else {
      setItems(items.map((item) =>
        item.productSlug === productSlug ? { ...item, quantity } : item
      ));
    }
  }

  function removeItem(productSlug: string) {
    setSuccessMessage(null);
    setItems(items.filter((item) => item.productSlug !== productSlug));
  }

  async function handlePurchase() {
    if (items.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch("/api/orders/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((i) => ({ productSlug: i.productSlug, quantity: i.quantity })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to complete bulk purchase.");
        return;
      }

      setSuccessMessage(`Bulk order placed: ${data.count} ${data.count === 1 ? "item" : "items"}. Codes appear in your orders as they arrive. Reference: ${data.reference}`);
      setItems([]);
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const result = calculateBulkOrder(items);
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const discountMessage = getBulkDiscountMessage(totalQuantity, result.discountPercent);

  return (
    <>
      <div className="space-y-6">
      {/* Add Items */}
      <div>
        <label className="block text-[0.86rem] font-medium text-ink mb-3">
          Select Products
        </label>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {allPlans.map((plan) => (
            <div
              key={plan.slug}
              className="rounded-xl border border-line bg-white p-4"
            >
              <div className="mb-3">
                <p className="text-[0.9rem] font-semibold text-ink">{plan.name}</p>
                <p className="text-[0.82rem] text-ink-2">{plan.planLabel}</p>
                <p className="text-[1rem] font-bold text-lav-600 mt-2">
                  {formatNaira(plan.price)}
                </p>
              </div>
              <button
                onClick={() => addItem(plan.slug)}
                className="w-full rounded-lg bg-lav-100 px-3 py-2 text-[0.82rem] font-semibold text-lav-700 transition-colors hover:bg-lav-200"
              >
                Add to Order
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Cart */}
      {items.length > 0 && (
        <div className="rounded-xl border border-line bg-white p-6">
          <h2 className="text-[1.1rem] font-semibold text-ink mb-4">
            Your Order
          </h2>
          <div className="space-y-3 mb-6">
            {items.map((item) => {
              const plan = findPlan(item.productSlug);
              if (!plan) return null;
              return (
                <div key={item.productSlug} className="flex items-center gap-4 border-b border-line pb-3">
                  <div className="flex-1">
                    <p className="text-[0.9rem] font-semibold text-ink">{plan.name}</p>
                    <p className="text-[0.82rem] text-ink-2">{formatNaira(plan.price)} each</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateQuantity(item.productSlug, item.quantity - 1)}
                      className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white text-ink hover:bg-cream"
                    >
                      -
                    </button>
                    <span className="w-8 text-center text-[0.9rem] font-semibold text-ink">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => updateQuantity(item.productSlug, item.quantity + 1)}
                      className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white text-ink hover:bg-cream"
                    >
                      +
                    </button>
                    <button
                      onClick={() => removeItem(item.productSlug)}
                      className="ml-2 text-[0.82rem] text-red-600 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Discount Message */}
          {discountMessage && (
            <div className="rounded-lg bg-lav-50 p-3 mb-4">
              <p className="text-[0.86rem] font-medium text-lav-700">
                {discountMessage}
              </p>
            </div>
          )}

          {/* Order Summary */}
          <div className="space-y-2 border-t border-line pt-4">
            <div className="flex justify-between text-[0.9rem] text-ink-2">
              <span>Subtotal</span>
              <span>{formatNaira(result.subtotal)}</span>
            </div>
            {result.discount > 0 && (
              <div className="flex justify-between text-[0.9rem] text-green-600">
                <span>Discount ({result.discountPercent}%)</span>
                <span>-{formatNaira(result.discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-[1.1rem] font-bold text-ink pt-2 border-t border-line">
              <span>Total</span>
              <span>{formatNaira(result.total)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Wallet Balance */}
      <div className="rounded-xl border border-line bg-cream p-4">
        <p className="text-[0.86rem] text-ink-2">Wallet Balance</p>
        <p className="text-[1.5rem] font-bold text-ink">
          {formatNaira(user.walletBalance)}
        </p>
      </div>

      {/* Messages */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[0.9rem] text-red-700">
          {error}
        </div>
      )}
      {successMessage && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-[0.9rem] text-green-700">
          {successMessage}
        </div>
      )}

      {/* Purchase Button */}
      {items.length > 0 && (
        <button
          type="button"
          onClick={handlePurchase}
          disabled={submitting}
          className="w-full rounded-xl bg-lav-600 px-6 py-4 text-[1rem] font-semibold text-white transition-colors hover:bg-lav-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Processing purchase..." : `Purchase (${totalQuantity} ${totalQuantity === 1 ? "item" : "items"}) · ${formatNaira(result.total)}`}
        </button>
      )}
    </div>
    </>
  );
}
