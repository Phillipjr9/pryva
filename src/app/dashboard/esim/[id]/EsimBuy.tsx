"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ArrowRight, Lock } from "@/components/icons";
import { formatNaira } from "@/lib/services/catalog";

/**
 * One eSIM plan, one button.
 *
 * The request key and confirmed terms are persisted for recovery across reloads.
 * A retry must replay the order it already created rather than buy a second
 * profile. Pending and uncertain attempts retain their key. `crypto.randomUUID` is unavailable on a non-secure origin, and a
 * constant fallback would make every customer share one key, so the fallback
 * still generates a random RFC-4122 shape.
 */
function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const hex = (digits: number) => Math.floor(Math.random() * 16 ** digits).toString(16).padStart(digits, "0");
  const variant = "89ab"[Math.floor(Math.random() * 4)];
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
}

export function EsimBuy({
  offerId,
  userId,
  name,
  price,
  expectedTerms,
  balance,
  purchasable,
}: {
  offerId: string;
  userId: string;
  name: string;
  price: number;
  expectedTerms: string;
  balance: number;
  purchasable: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsFunds, setNeedsFunds] = useState(balance < price);
  const inFlight = useRef(false);
  const storageKey = `pryva.esim.pending.v1.${userId}.${offerId}`;
  type Attempt = { requestId: string; price: number; terms: string };

  function requestAttempt(): Attempt {
    if (!userId) throw new Error("Account identity unavailable");
    const saved = window.localStorage.getItem(storageKey);
    if (saved !== null) {
      // Corrupt state might represent a paid request whose response was lost.
      // Never silently replace it with a new purchase key.
      const value: unknown = JSON.parse(saved);
      if (!value || typeof value !== "object") throw new Error("Invalid recovery state");
      const entry = value as Partial<Attempt>;
      if (typeof entry.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry.requestId) ||
          !Number.isSafeInteger(entry.price) || (entry.price ?? 0) <= 0 || typeof entry.terms !== "string" || !/^[a-f0-9]{24}$/.test(entry.terms)) {
        throw new Error("Invalid recovery state");
      }
      return entry as Attempt;
    }
    const entry = { requestId: newRequestId(), price, terms: expectedTerms };
    const serialized = JSON.stringify(entry);
    window.localStorage.setItem(storageKey, serialized);
    if (window.localStorage.getItem(storageKey) !== serialized) throw new Error("Could not save recovery state");
    return entry;
  }

  function clearAttempt() {
    window.localStorage.removeItem(storageKey);
  }

  async function buy() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    let attempt: Attempt;
    try {
      attempt = requestAttempt();
    } catch {
      setError("Order recovery information is unavailable. Check your orders and contact support before trying again.");
      setPending(false);
      inFlight.current = false;
      return;
    }
    try {
      const response = await fetch("/api/esim/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerId, requestId: attempt.requestId, expectedPriceNgn: attempt.price, expectedTerms: attempt.terms,
          ...(attempt.price !== price || attempt.terms !== expectedTerms ? { recoveryOnly: true } : {}) }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        safeToRetry?: boolean;
        order?: { id?: string; status?: string };
        balance?: number;
      };
      if (payload.safeToRetry === true) {
        try { clearAttempt(); } catch { /* retaining the key is safer than a duplicate purchase */ }
      }
      if (response.status === 402) {
        setNeedsFunds(true);
        setError(payload.error ?? "Your wallet balance is too low for this order.");
        return;
      }
      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "We couldn't complete that order. Please try again.");
        return;
      }
      if (payload.order?.id) {
        // Preserve pending/review keys across reloads until an existing order is
        // settled. A replay then clears the key without buying a second profile.
        if (payload.order.status === "active" || payload.order.status === "delivered") {
          try { clearAttempt(); } catch { /* retaining the key is safer */ }
        }
        router.push(`/dashboard/orders/${payload.order.id}`);
        return;
      }
      router.refresh();
    } catch {
      setError("The purchase outcome is uncertain. Check your orders before trying again; a retry will use the same request.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  if (!purchasable) {
    return (
      <div className="rounded-2xl border border-line bg-cream/60 px-4 py-3 text-meta text-ink-2">
        This plan isn&apos;t available to buy right now. Nothing has been charged.
      </div>
    );
  }

  return (
    <div className="grid gap-2.5">
      <div className="flex items-center justify-between text-meta text-ink-3">
        <span>Wallet balance</span>
        <span className="font-semibold text-ink">{formatNaira(balance)}</span>
      </div>
      {needsFunds ? (
        <Link
          href="/dashboard/wallet"
          className="inline-flex w-fit text-meta font-semibold text-lav-700 underline underline-offset-2"
        >
          Top up your wallet
        </Link>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-meta text-rose-700">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={buy}
        disabled={pending || !purchasable}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-lav-700 px-5 py-3 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-lav-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Buying…" : `Buy ${name} · ${formatNaira(price)}`}
        {pending ? null : <ArrowRight className="h-4 w-4" />}
      </button>
      <p className="flex items-center gap-1.5 text-micro text-ink-3">
        <Lock className="h-3 w-3" aria-hidden="true" /> Charged from your wallet once the profile is issued.
      </p>
    </div>
  );
}
