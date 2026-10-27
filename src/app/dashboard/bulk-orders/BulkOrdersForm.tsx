"use client";

import { useState } from "react";
import { plans, formatNaira, findPlan } from "@/lib/catalog";
import { calculateBulkOrder, getBulkDiscountMessage, type BulkOrderItem } from "@/lib/bulk-orders";
import { PaymentSuccess } from "@/components/ui/PaymentSuccess";
import { PaymentLoading } from "@/components/ui/PaymentLoading";
import type { PublicUser } from "@/lib/auth";

interface BulkOrdersFormProps {
  user: PublicUser;
}

export function BulkOrdersForm({ user }: BulkOrdersFormProps) {
  const [items, setItems] = useState<BulkOrderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<{ total: number; discount: number; discountPercent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allPlans = plans.filter((p) => ["numbers", "esim", "proxies", "email-otp"].includes(p.service));

  function addItem(productSlug: string) {
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
    if (quantity <= 0) {
      setItems(items.filter((item) => item.productSlug !== productSlug));
    } else {
      setItems(items.map((item) =>
        item.productSlug === productSlug ? { ...item, quantity } : item
      ));
    }
  }

  function removeItem(productSlug: string) {
    setItems(items.filter((item) => item.productSlug !== productSlug));
  }

  const result = calculateBulkOrder(items);
  const discountMessage = getBulkDiscountMessage(items.reduce((sum, item) => sum + item.quantity, 0));

  async function handlePurchase() {
    if (items.length === 0) {
      setError("Please add at least one item to your order");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/orders/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Purchase failed");
      }

      setSuccess({
        total: data.total,
        discount: data.discount,
        discountPercent: data.discountPercent,
      });
      setItems([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Purchase failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PaymentLoading show={loading} message="Processing your bulk order..." />
      <PaymentSuccess
        show={!!success}
        title="Bulk Order Completed!"
        message={`Total: ${formatNaira(success?.total || 0)}${success?.discount ? ` (${success.discountPercent}% discount applied)` : ''}`}
        redirectUrl="/dashboard"
        redirectDelay={2500}
      />
      <div className="space-y-6">
      {/* Add Items */}
      <div>
        <label className="block text-[0.86rem] font-medium text-ink mb-3">
          Select Products
        </label>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {allPlans.slice(0, 12).map((plan) => (
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

      {success && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
          <p className="text-[1.1rem] font-semibold text-green-700 mb-2">
            Order Completed!
          </p>
          <p className="text-[0.9rem] text-green-600">
            Total: {formatNaira(success.total)}
            {success.discount > 0 && ` (${success.discountPercent}% discount applied)`}
          </p>
          <p className="mt-2 text-[0.86rem] text-green-600">
            All items delivered to your dashboard
          </p>
        </div>
      )}

      {/* Purchase Button */}
      {!success && items.length > 0 && (
        <button
          onClick={handlePurchase}
          disabled={loading}
          className="w-full rounded-xl bg-lav-600 px-6 py-4 text-[1rem] font-semibold text-white transition-colors hover:bg-lav-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Processing..." : `Purchase Order for ${formatNaira(result.total)}`}
        </button>
      )}
    </div>
    </>
  );
}
