"use client";

import { useEffect, useRef, useState } from "react";
import { plans, formatNaira, findPlan } from "@/lib/services/catalog";
import { calculateBulkOrder, getBulkDiscountMessage, type BulkOrderItem } from "@/lib/services/bulk-orders";
import type { PublicUser } from "@/lib/identity/auth";

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
  const [recovering, setRecovering] = useState(false);
  const [ready, setReady] = useState(false);
  const [inReview, setInReview] = useState(false);
  const sending = useRef(false);
  const storageKey = `pryva.bulk.pending.v1.${user.id}`;
  useEffect(() => {
    let cancelled = false;
    // Storage is a browser-only external source; wait until after hydration and
    // never enable checkout before recovery has been inspected.
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const pending = JSON.parse(window.localStorage.getItem(storageKey) || "null");
        if (pending && typeof pending.id === "string" && Array.isArray(pending.items)) {
          setItems(pending.items);
          setRecovering(true);
        }
      } catch { setError("Could not read a previous batch. Check your orders before buying again."); setInReview(true); }
      finally { setReady(true); }
    });
    return () => { cancelled = true; };
  }, [storageKey]);

  const sellable = new Set(sellableSlugs);
  const allPlans = plans.filter((p) => sellable.has(p.slug));

  function addItem(productSlug: string) {
    if (!ready || recovering) return;
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
    if (recovering) return;
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
    if (recovering) return;
    setSuccessMessage(null);
    setItems(items.filter((item) => item.productSlug !== productSlug));
  }

  async function handlePurchase() {
    if (!ready || items.length === 0 || sending.current || inReview) return;
    let pending: { id: string; items: BulkOrderItem[] };
    try {
      const stored = window.localStorage.getItem(storageKey);
      pending = stored ? JSON.parse(stored) : { id: crypto.randomUUID(), items };
      window.localStorage.setItem(storageKey, JSON.stringify(pending));
      if (!window.localStorage.getItem(storageKey)) throw new Error("Storage unavailable");
    } catch {
      setError("Could not save recovery information. No order was sent.");
      return;
    }
    sending.current = true;
    setRecovering(true);
    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await fetch("/api/orders/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: pending.id, items: pending.items }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Could not confirm the batch. Check your orders and wallet before retrying.");
        return;
      }
      if (data.pending) {
        setInReview(true);
        setError(data.message || "This batch needs review. Check your orders and wallet before placing another.");
        return;
      }
      try { window.localStorage.removeItem(storageKey); setRecovering(false); } catch { /* replay is safer */ }
      const active = Array.isArray(data.units) ? data.units.filter((unit: { status?: string }) => unit.status === "active").length : 0;
      const refunded = Array.isArray(data.units) ? data.units.filter((unit: { status?: string }) => unit.status === "refunded").length : 0;
      setSuccessMessage(`Batch processed: ${active} active, ${refunded} refunded. Check your orders for details.`);
      setItems([]);
    } catch {
      setError("Could not confirm the batch. Check your orders and wallet before retrying this same request.");
    } finally { setSubmitting(false); sending.current = false; }
  }

  const result = calculateBulkOrder(items);
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const discountMessage = getBulkDiscountMessage(totalQuantity, result.discountPercent);

  return (
    <>
      <div className="space-y-6">
      {recovering && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">A previous batch is being recovered. Its items cannot be changed until its outcome is known.</p>}
      {/* Add Items */}
      <div>
        <label className="block text-[0.875rem] font-medium text-ink mb-3">
          Select Products
        </label>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {allPlans.map((plan) => (
            <div
              key={plan.slug}
              className="rounded-xl border border-line bg-white p-4"
            >
              <div className="mb-3">
                <p className="text-[0.875rem] font-semibold text-ink">{plan.name}</p>
                <p className="text-[0.8125rem] text-ink-2">{plan.planLabel}</p>
                <p className="text-[1rem] font-bold text-lav-600 mt-2">
                  {formatNaira(plan.price)}
                </p>
              </div>
              <button
                onClick={() => addItem(plan.slug)}
                disabled={!ready || recovering}
                className="w-full rounded-lg bg-lav-100 px-3 py-2 text-[0.8125rem] font-semibold text-lav-700 transition-colors hover:bg-lav-200"
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
          <h2 className="text-[1.125rem] font-semibold text-ink mb-4">
            Your Order
          </h2>
          <div className="space-y-3 mb-6">
            {items.map((item) => {
              const plan = findPlan(item.productSlug);
              if (!plan) return null;
              return (
                <div key={item.productSlug} className="flex items-center gap-4 border-b border-line pb-3">
                  <div className="flex-1">
                    <p className="text-[0.875rem] font-semibold text-ink">{plan.name}</p>
                    <p className="text-[0.8125rem] text-ink-2">{formatNaira(plan.price)} each</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateQuantity(item.productSlug, item.quantity - 1)}
                      className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white text-ink hover:bg-cream"
                    >
                      -
                    </button>
                    <span className="w-8 text-center text-[0.875rem] font-semibold text-ink">
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
                      className="ml-2 text-[0.8125rem] text-red-600 hover:text-red-700"
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
              <p className="text-[0.875rem] font-medium text-lav-700">
                {discountMessage}
              </p>
            </div>
          )}

          {/* Order Summary */}
          <div className="space-y-2 border-t border-line pt-4">
            <div className="flex justify-between text-[0.875rem] text-ink-2">
              <span>Subtotal</span>
              <span>{formatNaira(result.subtotal)}</span>
            </div>
            {result.discount > 0 && (
              <div className="flex justify-between text-[0.875rem] text-green-600">
                <span>Discount ({result.discountPercent}%)</span>
                <span>-{formatNaira(result.discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-[1.125rem] font-bold text-ink pt-2 border-t border-line">
              <span>Total</span>
              <span>{formatNaira(result.total)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Wallet Balance */}
      <div className="rounded-xl border border-line bg-cream p-4">
        <p className="text-[0.875rem] text-ink-2">Wallet Balance</p>
        <p className="text-[1.5rem] font-bold text-ink">
          {formatNaira(user.walletBalance)}
        </p>
      </div>

      {/* Messages */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[0.875rem] text-red-700">
          {error}
        </div>
      )}
      {successMessage && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-[0.875rem] text-green-700">
          {successMessage}
        </div>
      )}

      {/* Purchase Button */}
      {items.length > 0 && (
        <button
          type="button"
          onClick={handlePurchase}
          disabled={!ready || submitting || inReview}
          className="w-full rounded-xl bg-lav-700 px-6 py-4 text-[1rem] font-semibold text-white transition-colors hover:bg-lav-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Processing purchase..." : `Purchase (${totalQuantity} ${totalQuantity === 1 ? "item" : "items"}) · ${formatNaira(result.total)}`}
        </button>
      )}
    </div>
    </>
  );
}
