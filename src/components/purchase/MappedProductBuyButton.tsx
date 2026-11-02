"use client";

import { useRef, useState } from "react";
import Link from "next/link";

import { formatNaira } from "@/lib/catalog";

/** Kept as a local union so a client component never imports a server-only module. */
type Family = "data" | "subscriptions" | "proxies";

const ENDPOINTS: Record<Family, string> = {
  data: "/api/airtime/purchase",
  subscriptions: "/api/digital/purchase",
  proxies: "/api/proxies/purchase",
};

type Result = {
  ok?: boolean;
  error?: string;
  code?: string | null;
  orderId?: string;
  reference?: string;
  balance?: number;
};

/**
 * The one checkout control for a mapped catalogue product.
 *
 * `requestId` is held in a ref so a retry after a timeout replays the same
 * purchase instead of buying a second unit. The server owns the price, the
 * margin check and the delivery call; this component only posts our own plan ID.
 */
export function MappedProductBuyButton({
  family,
  planId,
  name,
  price,
  walletBalance,
  disabledReason,
}: {
  family: Family;
  planId: string;
  name: string;
  price: number;
  walletBalance: number;
  /** Set when the selected plan is not mapped yet; keeps the button honest. */
  disabledReason?: string;
}) {
  const requestId = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const shortOfFunds = walletBalance < price;

  async function buy() {
    if (pending || result?.ok) return;
    if (!requestId.current) requestId.current = crypto.randomUUID();
    setPending(true);
    setResult(null);
    try {
      const response = await fetch(ENDPOINTS[family], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId, requestId: requestId.current }),
      });
      const data = (await response.json().catch(() => ({}))) as Result;
      setResult({ ...data, ok: response.ok && data.ok === true });
    } catch {
      setResult({ ok: false, error: "We could not reach the server. Nothing was charged — please try again." });
    } finally {
      setPending(false);
    }
  }

  if (disabledReason) {
    return (
      <button
        type="button"
        disabled
        className="w-full rounded-xl bg-lav-600 px-6 py-4 text-[1rem] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {disabledReason}
      </button>
    );
  }

  if (result?.ok) {
    return (
      <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-[0.88rem] leading-relaxed text-emerald-900">
        <p className="font-semibold">{name} is ready.</p>
        {result.code && (
          <p className="mt-2">
            Delivery code: <code className="rounded bg-white px-2 py-1 font-mono font-semibold">{result.code}</code>
          </p>
        )}
        <p className="mt-2 text-meta">
          Reference {result.reference}. {typeof result.balance === "number" && `Wallet balance ${formatNaira(result.balance)}.`}
        </p>
        {result.orderId && (
          <Link href={`/dashboard/orders/${result.orderId}`} className="mt-3 inline-flex font-semibold underline underline-offset-2">
            View order →
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {shortOfFunds && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-meta text-amber-900">
          Your wallet is short of {formatNaira(price)}.{" "}
          <Link href="/dashboard/wallet" className="font-semibold underline underline-offset-2">Top up wallet</Link>.
        </p>
      )}
      <button
        type="button"
        onClick={buy}
        disabled={pending || shortOfFunds}
        className="w-full rounded-xl bg-lav-600 px-6 py-4 text-[1rem] font-semibold text-white transition-colors hover:bg-lav-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Processing…" : `Buy ${name} · ${formatNaira(price)}`}
      </button>
      {result && !result.ok && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-meta text-rose-900">
          <p className="font-semibold">{result.error || "The order could not be completed."}</p>
        </div>
      )}
    </div>
  );
}
