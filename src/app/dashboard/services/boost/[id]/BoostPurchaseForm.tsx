"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Lock } from "@/components/icons";
import { formatNaira } from "@/lib/services/catalog";
import { MAX_BOOST_QUANTITY, totalForQuantity } from "@/lib/services/boosts/boost-money";

/**
 * Same idempotency-key rule as every other purchase: one key per attempt, kept
 * across a retry of that attempt, replaced only after success. A boost cannot be
 * placed twice by a double click, a second tab or a resubmit after a timeout —
 * and the supplier has no idempotency key of its own, so this is the only thing
 * standing between a retry and a second charge.
 */
function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const hex = (digits: number) =>
    Math.floor(Math.random() * 16 ** digits).toString(16).padStart(digits, "0");
  const variant = "89ab"[Math.floor(Math.random() * 4)];
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
}

type Listing = {
  id: string;
  name: string;
  tag: string;
  perThousand: number;
  min: number;
  max: number | null;
  terms: string;
};

function isListing(value: unknown, expectedId: string): value is Listing {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<Listing>;
  return item.id === expectedId && typeof item.name === "string" && item.name.length > 0 && item.name.length <= 160 &&
    typeof item.tag === "string" && item.tag.length > 0 && item.tag.length <= 80 &&
    typeof item.perThousand === "number" && Number.isSafeInteger(item.perThousand) && item.perThousand > 0 &&
    typeof item.min === "number" && Number.isSafeInteger(item.min) && item.min > 0 && item.min <= MAX_BOOST_QUANTITY &&
    (item.max === null || (typeof item.max === "number" && Number.isSafeInteger(item.max) && item.max >= item.min)) &&
    typeof item.terms === "string" && /^[a-f0-9]{24}$/.test(item.terms);
}

type Receipt = { reference: string; amount: number; quantity: number; link: string; replayed: boolean };

export function BoostPurchaseForm({ listing, walletBalance }: { listing: Listing; walletBalance: number }) {
  const router = useRouter();
  const [currentListing, setCurrentListing] = useState(listing);
  const [quoteChanged, setQuoteChanged] = useState(false);
  const [link, setLink] = useState("");
  const [quantity, setQuantity] = useState<number>(listing.min);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const attempt = useRef<string | null>(null);

  const total = totalForQuantity(currentListing.perThousand, quantity);
  const shortfall = Math.max(0, total - walletBalance);
  const quantityValid =
    Number.isSafeInteger(quantity) && quantity <= MAX_BOOST_QUANTITY &&
    quantity >= currentListing.min &&
    (currentListing.max === null || quantity <= currentListing.max);

  async function buy() {
    if (pending) return;
    setError(null);
    if (!quantityValid) {
      setError(
        currentListing.max === null
          ? `Enter between ${currentListing.min.toLocaleString("en-NG")} and ${MAX_BOOST_QUANTITY.toLocaleString("en-NG")} units.`
          : `Enter between ${currentListing.min.toLocaleString("en-NG")} and ${Math.min(currentListing.max, MAX_BOOST_QUANTITY).toLocaleString("en-NG")} units.`,
      );
      return;
    }
    if (!link.trim()) {
      setError("Paste the public profile or post link you want boosted.");
      return;
    }
    if (!attempt.current) attempt.current = newRequestId();
    setPending(true);
    try {
      const response = await fetch("/api/boosts/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: currentListing.id, link, quantity, requestId: attempt.current,
          expectedTotalNgn: total, expectedTerms: currentListing.terms,
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        replayed?: boolean;
        balance?: number;
        outcome?: "refunded" | "unconfirmed";
        code?: string;
        quote?: unknown;
        order?: { reference: string; amount: number; quantity: number; targetLink: string; status: string };
      };
      if (response.status === 409 && data.code === "quote_changed" && isListing(data.quote, currentListing.id)) {
        setCurrentListing(data.quote);
        setQuoteChanged(true);
        setError("The price or service details changed. Review the updated details and total before confirming.");
        return;
      }
      if (!response.ok || !data.ok || !data.order) {
        const unconfirmed = "We couldn't confirm this order. Check your orders and wallet or contact support before trying again.";
        const refunded = "We couldn't confirm your boost. Your wallet has been refunded. Check your orders or contact support before placing another order.";
        const refundUnconfirmed = "We couldn't confirm your boost or its refund. Check your orders and wallet, then contact support before placing another order.";
        setError(response.status >= 500
          ? data.outcome === "refunded" ? refunded : data.outcome === "unconfirmed" ? refundUnconfirmed : unconfirmed
          : typeof data.error === "string" ? data.error : unconfirmed);
        return;
      }
      if (data.order.status !== "active") {
        setError(data.order.status === "refunded"
          ? "This order was refunded. Check your orders and wallet before placing another order."
          : data.order.status === "delivered"
            ? "This order was already delivered. Check your orders before placing another order."
            : "We couldn't confirm this order's status. Check your orders or contact support before placing another order.");
        return;
      }
      attempt.current = null;
      setReceipt({
        reference: data.order.reference,
        amount: data.order.amount,
        quantity: data.order.quantity,
        link: data.order.targetLink,
        replayed: Boolean(data.replayed),
      });
      router.refresh();
    } catch {
      // Keep the key for this attempt, but a lost response is not proof that
      // nothing happened; check the existing order before submitting another.
      setError("We couldn't confirm this order. Check your orders and wallet or contact support before trying again.");
    } finally {
      setPending(false);
    }
  }

  if (receipt) {
    return (
      <div className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50/60 p-5">
        <p className="flex items-center gap-2 text-[0.95rem] font-semibold text-emerald-900">
          <Check className="h-4 w-4" /> Boost started
        </p>
        <p className="mt-1 text-meta text-emerald-900">
          {receipt.quantity.toLocaleString("en-NG")} {currentListing.tag.toLowerCase()} for{" "}
          <span className="break-all">{receipt.link}</span>. Reference <strong>{receipt.reference}</strong> ·{" "}
          {formatNaira(receipt.amount)}.
        </p>
        {receipt.replayed && (
          <p className="mt-1 text-micro text-emerald-800">That was already placed — this is the same order, not a second charge.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-3">
          <Link href="/dashboard/orders" className="btn btn-primary !px-4 !py-2.5 !text-[0.8rem]">
            View orders <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <button
            type="button"
            onClick={() => { setReceipt(null); setLink(""); setQuantity(currentListing.min); }}
            className="btn border border-line bg-white !px-4 !py-2.5 !text-[0.8rem] text-ink"
          >
            Buy another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
      {quoteChanged && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-meta text-amber-900">
          Updated service: <strong>{currentListing.name}</strong> · {currentListing.tag}. Review the amount below before paying.
        </p>
      )}
      <div>
        <label htmlFor="boost-link" className="field-label">
          Profile or post link
        </label>
        <input
          id="boost-link"
          type="url"
          inputMode="url"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          placeholder="https://instagram.com/yourprofile"
          className="field"
          autoComplete="off"
        />
        <p className="mt-1 text-meta text-ink-3">Must be public while the boost runs, and https.</p>
      </div>

      <div>
        <label htmlFor="boost-quantity" className="field-label">
          How many
        </label>
        <input
          id="boost-quantity"
          type="number"
          min={currentListing.min}
          max={Math.min(currentListing.max ?? MAX_BOOST_QUANTITY, MAX_BOOST_QUANTITY)}
          step={1}
          value={Number.isFinite(quantity) ? quantity : ""}
          onChange={(event) => setQuantity(Number(event.target.value))}
          className="field"
        />
        <p className="mt-1 text-meta text-ink-3">
          {currentListing.min.toLocaleString("en-NG")}
          {currentListing.max === null ? "+" : `–${currentListing.max.toLocaleString("en-NG")}`} units ·{" "}
          {formatNaira(currentListing.perThousand)} per 1,000
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white px-3.5 py-3">
        <span className="text-meta text-ink-2">Total</span>
        <span className="text-[1.05rem] font-semibold text-ink">{formatNaira(total)}</span>
      </div>

      {quantityValid && total === 0 && (
        <p className="text-meta text-amber-800">This amount cannot be ordered. Try a smaller quantity.</p>
      )}
      {shortfall > 0 && (
        <p className="text-meta text-amber-800">
          You need {formatNaira(shortfall)} more in your wallet.{" "}
          <Link href="/dashboard/wallet" className="font-semibold underline">Top up</Link>
        </p>
      )}

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-meta font-medium text-rose-700">{error}</p>}

      <button
        type="button"
        onClick={buy}
        disabled={pending || !quantityValid || total <= 0 || shortfall > 0}
        className="btn btn-primary w-fit !px-5 !py-2.5 !text-[0.82rem] disabled:opacity-50"
      >
        {pending ? "Placing order…" : <>Pay {formatNaira(total)} from wallet</>}
      </button>
      <p className="flex items-center gap-1.5 text-micro text-ink-3">
        <Lock className="h-3 w-3" /> Charged from your Pryva wallet. If delivery or a refund is not confirmed, check your
        orders and wallet or contact support.
      </p>
    </div>
  );
}
