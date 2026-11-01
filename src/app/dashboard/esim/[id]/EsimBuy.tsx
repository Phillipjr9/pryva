"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ArrowRight, Lock } from "@/components/icons";
import { formatNaira } from "@/lib/catalog";

/**
 * One eSIM plan, one button.
 *
 * The request key is kept for the whole attempt and only replaced once the
 * attempt succeeds or the plan changes: a browser retry or a resubmit after a
 * timeout must replay the order it already created rather than buy a second
 * profile. `crypto.randomUUID` is unavailable on a non-secure origin, and a
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
  name,
  price,
  balance,
  purchasable,
}: {
  offerId: string;
  name: string;
  price: number;
  balance: number;
  purchasable: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsFunds, setNeedsFunds] = useState(balance < price);
  const attempt = useRef<{ offerId: string; requestId: string } | null>(null);

  function requestId(): string {
    if (attempt.current?.offerId === offerId) return attempt.current.requestId;
    const requestId = newRequestId();
    attempt.current = { offerId, requestId };
    return requestId;
  }

  async function buy() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/esim/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerId, requestId: requestId() }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        order?: { id?: string };
        balance?: number;
      };
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
        router.push(`/dashboard/orders/${payload.order.id}`);
        return;
      }
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
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
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-lav-600 px-5 py-3 text-[0.95rem] font-semibold text-white transition-colors hover:bg-lav-700 disabled:cursor-not-allowed disabled:opacity-60"
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
