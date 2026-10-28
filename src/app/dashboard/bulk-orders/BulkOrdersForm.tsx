"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { plans, formatNaira, findPlan } from "@/lib/catalog";
import { calculateBulkOrder, getBulkDiscountMessage, type BulkOrderItem } from "@/lib/bulk-orders";
import { PaymentLoading } from "@/components/ui/PaymentLoading";
import type { PublicUser } from "@/lib/auth";

interface BulkOrdersFormProps {
  user: PublicUser;
  preview: boolean;
}

export function BulkOrdersForm({ user, preview }: BulkOrdersFormProps) {
  const router = useRouter();
  const [items, setItems] = useState<BulkOrderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<{ total: number; discount: number; discountPercent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);

  const allPlans = plans.filter((p) => ["numbers", "esim", "proxies", "email-otp"].includes(p.service));

  function addItem(productSlug: string) {
    if (totalQuantity >= 200) { setError("A basket can contain at most 200 items."); return; }
    setError(null);
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
    if (totalQuantity - current + quantity > 200) { setError("A basket can contain at most 200 items."); return; }
    setError(null);
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
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const discountMessage = getBulkDiscountMessage(totalQuantity, result.discountPercent);

  async function handlePurchase() {
    if (!preview || unconfirmed) return;
    if (items.length === 0) {
      setError("Please add at least one item to your order");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const [response] = await Promise.all([
        fetch("/api/orders/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) }),
        new Promise((resolve) => setTimeout(resolve, 1600)),
      ]);

      const data = await response.json();

      if (!response.ok || !data.ok) {
        if (response.status >= 500) {
          setUnconfirmed(true);
          setError("The simulation may have been recorded. Check your orders before trying again.");
        } else {
          setError(data.error || "Purchase failed");
        }
        return;
      }

      setSuccess({
        total: data.total,
        discount: data.discount,
        discountPercent: data.discountPercent,
      });
      setItems([]);
      router.refresh();
    } catch {
      setUnconfirmed(true);
      setError("The simulation may have been recorded. Check your orders before trying again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PaymentLoading show={loading} message="Processing your bulk order..." />
      <div className="space-y-6">
      <div role="status" className={`rounded-xl border p-4 text-sm ${preview ? "border-lav-200 bg-lav-50 text-lav-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
        {preview ? "Demo basket: each item creates a simulated order with fictional delivery details." : "Live bulk purchasing is currently unavailable."}
      </div>
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
          {unconfirmed && <div className="mt-2 flex gap-4"><Link href="/dashboard/orders" className="font-semibold underline">Check orders</Link><button type="button" className="font-semibold underline" onClick={() => { setUnconfirmed(false); setError(null); }}>I checked; start another simulation</button></div>}
        </div>
      )}

      {success && (
        <div className="demo-arrive rounded-xl border border-green-200 bg-green-50 p-6 text-center">
          <p className="text-[1.1rem] font-semibold text-green-700 mb-2">
            Simulated order recorded
          </p>
          <p className="text-[0.9rem] text-green-600">
            Total: {formatNaira(success.total)}
            {success.discount > 0 && ` (${success.discountPercent}% discount applied)`}
          </p>
          <p className="mt-2 text-[0.86rem] text-green-600">
            Your demo orders are ready. Number and inbox codes arrive in their order details; no real service was delivered.
          </p>
          <Link href="/dashboard/orders" className="mt-3 inline-block font-semibold underline">View orders</Link>
          <button type="button" className="ml-4 mt-3 font-semibold underline" onClick={() => setSuccess(null)}>Start another simulation</button>
        </div>
      )}

      {/* Purchase Button */}
      {!success && items.length > 0 && (
        <button
          onClick={handlePurchase}
          disabled={loading || !preview || unconfirmed}
          className="w-full rounded-xl bg-lav-600 px-6 py-4 text-[1rem] font-semibold text-white transition-colors hover:bg-lav-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Processing..." : `Simulate order for ${formatNaira(result.total)}`}
        </button>
      )}
    </div>
    </>
  );
}
