"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Check, Clock, Copy, Shield } from "@/components/icons";
import { formatNaira } from "@/lib/catalog";

type Props = {
  orderId: string;
  status: string;
  expiresAt: string | null;
  amount: number;
  referenceCode: string | null;
  otpCode: string | null;
  service: string;
  /** Server-computed: this order's code can be re-read while the window is open. */
  refreshableCode?: boolean;
  initialNow: number;
};

function timeLeft(target: string | null, now: number): string | null {
  if (!target) return null;
  const diff = new Date(target).getTime() - now;
  if (!Number.isFinite(diff) || diff <= 0) return null;
  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function OrderActions({
  orderId,
  status,
  expiresAt,
  amount,
  referenceCode,
  otpCode,
  service,
  refreshableCode = false,
  initialNow,
}: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  // Use the server timestamp for the first render; switch to the browser clock
  // in the interval after hydration.
  const [remaining, setRemaining] = useState<string | null>(() => timeLeft(expiresAt, initialNow));
  const [settledStatus, setSettledStatus] = useState(status);
  const [liveOtp, setLiveOtp] = useState<string | null>(otpCode);
  const [synced, setSynced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(service === "numbers" || service === "email-otp");

  const isLiveProvider = refreshableCode;
  const liveWindowOpen = !expiresAt || remaining !== null;
  useEffect(() => {
    if (!expiresAt) return;
    const interval = setInterval(() => setRemaining(timeLeft(expiresAt, Date.now())), 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  // Re-read the delivered code while the order is active.
  useEffect(() => {
    if (!isLiveProvider || settledStatus !== "active" || !liveWindowOpen) return;
    let cancelled = false;

    async function sync() {
      try {
        const response = await fetch(`/api/orders/${orderId}/sync`, { cache: "no-store" });
        const data = (await response.json()) as {
          ok?: boolean;
          otpCode?: string | null;
          status?: string;
        };
        if (!response.ok || !data.ok || cancelled) return;
        setSynced(true);
        if (data.otpCode) setLiveOtp(data.otpCode);
        if (data.status && data.status !== settledStatus) setSettledStatus(data.status);
      } catch {
        /* keep polling on next tick */
      }
    }

    sync();
    // The supplier recommends polling every 20–30 seconds, not continuously.
    const interval = setInterval(sync, 25_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [orderId, isLiveProvider, settledStatus, liveWindowOpen]);

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setError("Copying isn't available in this browser. Select the text instead.");
    }
  }

  const active = settledStatus === "active";
  const expired = active && expiresAt !== null && !remaining;

  return (
    <div className="grid gap-3.5">
      <div className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-ink-3">
            {service === "numbers"
              ? "Your number & code"
              : service === "esim"
                ? "eSIM activation details"
                : service === "proxies"
                  ? "Proxy credentials"
                  : service === "email-otp"
                    ? "Your temporary inbox"
                    : service === "social"
                      ? "Promotion progress"
                      : "Order details"}
          </p>
          <span className="flex items-center gap-1.5">
            {isLiveProvider && (
              <span className="inline-flex items-center gap-1 rounded-full bg-lav-50 px-2.5 py-1 text-[0.62rem] font-semibold text-lav-700">
                <span className="h-1 w-1 rounded-full bg-emerald-500" />
                Live
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.66rem] font-semibold ${
                active
                  ? expired
                    ? "bg-amber-50 text-amber-700"
                    : "bg-emerald-50 text-emerald-700"
                  : settledStatus === "refunded"
                    ? "bg-amber-50 text-amber-700"
                    : "bg-lav-50 text-lav-700"
              }`}
            >
              {active ? (expired ? "Window closed" : "Live") : settledStatus === "refunded" ? "Refunded" : settledStatus}
            </span>
          </span>
        </div>

        {active && remaining && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-lav-50 px-3 py-1.5 text-[0.72rem] font-medium text-lav-700">
            <Clock className="h-3.5 w-3.5" /> Delivery window closes in {remaining}
          </p>
        )}

        {referenceCode ? (
          <div className="mt-3.5 rounded-2xl border border-line bg-cream/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <pre className="whitespace-pre-wrap break-words font-sans text-[0.88rem] leading-relaxed text-ink">
                {referenceCode}
              </pre>
              <button
                type="button"
                onClick={() => copy(referenceCode, "reference")}
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-white px-2.5 py-1.5 text-[0.66rem] font-semibold text-ink-2 hover:border-lav-300"
              >
                {copied === "reference" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied === "reference" ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-[0.84rem] text-ink-3">
            Delivery details are being prepared. Refresh in a moment.
          </p>
        )}

        {isLiveProvider && settledStatus === "active" && liveWindowOpen && !liveOtp && (
          <p className="mt-3 flex items-center gap-2 rounded-xl bg-lav-50 px-3.5 py-3 text-[0.78rem] font-medium text-lav-800">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-lav-600" />
            Waiting for the code — this page checks roughly every 25 seconds.
          </p>
        )}

        {liveOtp && (
          <div role="status" aria-live="polite" className="mt-3 rounded-2xl border border-lav-100 bg-gradient-to-br from-lav-50 to-white p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-lav-700">
                Verification code
              </p>
              <button type="button" onClick={() => copy(liveOtp, "otp")} className="inline-flex items-center gap-1 text-[0.68rem] font-semibold text-lav-700">
                {copied === "otp" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied === "otp" ? "Copied" : "Copy code"}
              </button>
            </div>
            <button type="button" onClick={() => setRevealed(true)} aria-label={revealed ? `Verification code ${liveOtp}` : "Reveal verification code"} className="mt-3 flex w-full gap-1.5 text-left">
              {(revealed ? liveOtp : "••••••").split("").map((digit, index) => (
                <span key={index} aria-hidden="true" className="otp-arrive grid h-11 min-w-0 flex-1 place-items-center rounded-lg border border-lav-200 bg-white font-mono text-[1.15rem] font-semibold text-lav-800" style={{ animationDelay: `${index * 70}ms` }}>{digit}</span>
              ))}
            </button>
            {!revealed && <p className="mt-2 text-[0.7rem] text-ink-3">Tap the code to reveal it.</p>}
          </div>
        )}

        {error && <p role="alert" className="mt-3 text-[0.78rem] font-medium text-rose-600">{error}</p>}
      </div>

      <div className="rounded-[1.5rem] border border-lav-200 bg-gradient-to-br from-lav-50 to-white p-5">
        <p className="flex items-center gap-2 text-[0.85rem] font-semibold text-ink">
          <Shield className="h-4 w-4 text-lav-700" /> Refund information
        </p>
        {settledStatus === "refunded" ? (
          <p className="mt-2 flex items-center gap-2 text-[0.82rem] text-ink-2">
            <Check className="h-4 w-4 text-emerald-600" />
            {formatNaira(amount)} was returned to your wallet. It&apos;s already spendable.
          </p>
        ) : active || settledStatus === "review" || settledStatus === "processing" ? (
          <p className="mt-2 text-[0.82rem] text-ink-2">
            Refunds require review. <a href="/dashboard/support" className="font-semibold underline">Contact support</a> with your order reference.
          </p>
        ) : (
          <p className="mt-2 flex items-center gap-2 text-[0.82rem] text-ink-2">
            <ArrowRight className="h-4 w-4 text-lav-600" />
            This order is settled. Buy another from the pricing page whenever you need one.
          </p>
        )}
      </div>
    </div>
  );
}
