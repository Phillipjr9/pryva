"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Clock, Copy, Refresh, Shield } from "@/components/icons";
import { formatNaira } from "@/lib/catalog";
import { useDemoOtp, useDemoPromotion } from "@/components/dashboard/useDemoOtp";

type Props = {
  orderId: string;
  status: string;
  expiresAt: string | null;
  amount: number;
  referenceCode: string | null;
  otpCode: string | null;
  service: string;
  provider?: string | null;
  preview?: boolean;
  demoUnitsRemaining?: number | null;
  canRequestPreviewRefund: boolean;
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
  provider = null,
  preview = false,
  demoUnitsRemaining = null,
  canRequestPreviewRefund,
  initialNow,
}: Props) {
  const router = useRouter();
  const [copied, setCopied] = useState<string | null>(null);
  // Use the server timestamp for the first render; switch to the browser clock
  // in the interval after hydration.
  const [remaining, setRemaining] = useState<string | null>(() => timeLeft(expiresAt, initialNow));
  const [settledStatus, setSettledStatus] = useState(status);
  const [liveOtp, setLiveOtp] = useState<string | null>(otpCode);
  const [synced, setSynced] = useState(false);
  const [pending, setPending] = useState(false);
  const [refunded, setRefunded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(service === "numbers" || service === "email-otp");
  const [nextPending, setNextPending] = useState(false);
  const nextAttempt = useRef<string | null>(null);
  const nextInFlight = useRef(false);
  const refreshedDemoCode = useRef<string | null>(otpCode);

  const isLiveProvider = provider === "fleexa";
  const liveWindowOpen = !expiresAt || remaining !== null;
  const isDemoOtp = preview && provider === "simulated" && (service === "numbers" || service === "email-otp");
  const { code: demoOtp, retrying: demoRetrying, resetCode } = useDemoOtp(
    orderId,
    isDemoOtp && settledStatus === "active" && (remaining !== null || expiresAt === null),
    otpCode,
  );
  const displayOtp = isDemoOtp ? demoOtp : liveOtp;
  const remainingDemoUnits = typeof demoUnitsRemaining === "number" && Number.isSafeInteger(demoUnitsRemaining) && demoUnitsRemaining >= 0
    ? Math.max(0, demoUnitsRemaining - (demoOtp && demoOtp !== otpCode ? 1 : 0)) : null;
  const isDemoPromotion = preview && provider === "simulated" && service === "social";
  const { finished: demoPromotionFinished, retrying: promotionRetrying } = useDemoPromotion(orderId, isDemoPromotion && settledStatus === "processing");
  const displayedStatus = demoPromotionFinished ? "delivered" : settledStatus;

  useEffect(() => {
    if (isDemoOtp && demoOtp && refreshedDemoCode.current !== demoOtp) {
      refreshedDemoCode.current = demoOtp;
      router.refresh();
    }
  }, [isDemoOtp, demoOtp, router]);
  useEffect(() => { if (demoPromotionFinished) router.refresh(); }, [demoPromotionFinished, router]);

  useEffect(() => {
    if (!expiresAt) return;
    const interval = setInterval(() => setRemaining(timeLeft(expiresAt, Date.now())), 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  // Live-sync the code from Fleexa while the order is active.
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

  async function requestNextDemoCode() {
    if (nextInFlight.current) return;
    nextInFlight.current = true;
    setNextPending(true);
    setError(null);
    try {
      nextAttempt.current ??= crypto.randomUUID();
      const response = await fetch(`/api/demo/orders/${encodeURIComponent(orderId)}/next`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: nextAttempt.current }),
      });
      const data = await response.json() as { ok?: boolean; simulated?: boolean; error?: string };
      if (!response.ok || !data.ok || !data.simulated) { setError(data.error ?? "Could not start the next demo code."); return; }
      nextAttempt.current = null;
      refreshedDemoCode.current = null;
      resetCode();
      router.refresh();
    } catch {
      setError("Could not confirm the next demo code. Refresh this order before retrying.");
    } finally {
      setNextPending(false);
      nextInFlight.current = false;
    }
  }

  async function requestRefund() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/refund`, { method: "POST" });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setError(data.error ?? "The refund didn't go through.");
        return;
      }
      setSettledStatus("refunded");
      setRefunded(true);
      router.refresh();
    } catch {
      setError("Network hiccup. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const active = displayedStatus === "active";
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
                  : displayedStatus === "refunded"
                    ? "bg-amber-50 text-amber-700"
                    : "bg-lav-50 text-lav-700"
              }`}
            >
              {active ? (expired ? "Window closed" : preview && provider === "simulated" ? "Demo active" : "Live") : displayedStatus === "refunded" ? "Refunded" : displayedStatus}
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
            {isDemoOtp && <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-lav-700">{service === "numbers" ? "Demo number" : "Demo inbox"}</p>}
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

        {isDemoPromotion && (
          <div role="status" aria-live="polite" className="mt-3 rounded-2xl border border-lav-200 bg-lav-50/70 p-4">
            <p className="text-[0.78rem] font-semibold text-ink">{displayedStatus === "delivered" ? "Demo campaign complete" : promotionRetrying ? "Checking demo progress…" : "Demo campaign in progress"}</p>
            <p className="mt-1 text-[0.7rem] text-ink-3">{displayedStatus === "delivered" ? "The fictional campaign is complete." : "Simulating activity for a fictional profile."}</p>
            <div aria-hidden="true" className="mt-3 h-1.5 overflow-hidden rounded-full bg-lav-100"><div className={displayedStatus === "delivered" ? "h-full w-full rounded-full bg-emerald-500" : "demo-progress h-full w-1/3 rounded-full bg-lav-600"} /></div>
          </div>
        )}

        {isDemoOtp && active && !expired && !displayOtp && (
          <div role="status" aria-live="polite" className="mt-3 rounded-2xl border border-lav-200 bg-gradient-to-br from-lav-50 to-white p-4">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-lav-100 text-lav-700">
                <span className="demo-breathe absolute inset-0 rounded-xl bg-lav-200" />
                <span className="relative text-lg">✦</span>
              </span>
              <div><p className="text-[0.79rem] font-semibold text-ink">Waiting for your demo code</p><p className="mt-0.5 text-[0.7rem] text-ink-3">{demoRetrying ? "Checking again shortly…" : "Your simulated message will appear here automatically."}</p></div>
            </div>
            <div aria-hidden="true" className="mt-4 flex gap-1.5">{Array.from({ length: 6 }, (_, index) => <span key={index} className="h-11 flex-1 animate-pulse rounded-lg border border-lav-100 bg-white" style={{ animationDelay: `${index * 90}ms` }} />)}</div>
          </div>
        )}

        {isLiveProvider && settledStatus === "active" && liveWindowOpen && !displayOtp && (
          <p className="mt-3 flex items-center gap-2 rounded-xl bg-lav-50 px-3.5 py-3 text-[0.78rem] font-medium text-lav-800">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-lav-600" />
            Waiting for the code — this page checks roughly every 25 seconds.
          </p>
        )}

        {displayOtp && (
          <div role="status" aria-live="polite" className="mt-3 rounded-2xl border border-lav-100 bg-gradient-to-br from-lav-50 to-white p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[0.66rem] font-semibold uppercase tracking-[0.14em] text-lav-700">
                {isDemoOtp ? "Demo code received" : "Verification code"}
              </p>
              <button type="button" onClick={() => copy(displayOtp, "otp")} className="inline-flex items-center gap-1 text-[0.68rem] font-semibold text-lav-700">
                {copied === "otp" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied === "otp" ? "Copied" : "Copy code"}
              </button>
            </div>
            <button type="button" onClick={() => setRevealed(true)} aria-label={revealed ? `Verification code ${displayOtp}` : "Reveal verification code"} className="mt-3 flex w-full gap-1.5 text-left">
              {(revealed ? displayOtp : "••••••").split("").map((digit, index) => (
                <span key={index} aria-hidden="true" className="otp-arrive grid h-11 min-w-0 flex-1 place-items-center rounded-lg border border-lav-200 bg-white font-mono text-[1.15rem] font-semibold text-lav-800" style={{ animationDelay: `${index * 70}ms` }}>{digit}</span>
              ))}
            </button>
            {!revealed && <p className="mt-2 text-[0.7rem] text-ink-3">Tap the code to reveal it.</p>}
          </div>
        )}

        {isDemoOtp && remainingDemoUnits !== null && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[0.72rem] text-ink-3">
            <span>My demo units: <strong className="text-ink">{remainingDemoUnits} left</strong></span>
            {displayOtp && active && !expired && remainingDemoUnits > 0 && <button type="button" disabled={nextPending} onClick={() => void requestNextDemoCode()} className="font-semibold text-lav-700 underline underline-offset-2 disabled:opacity-50">{nextPending ? "Preparing…" : "Use another demo unit"}</button>}
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-[0.78rem] font-medium text-rose-600">{error}</p>}
      </div>

      <div className="rounded-[1.5rem] border border-lav-200 bg-gradient-to-br from-lav-50 to-white p-5">
        <p className="flex items-center gap-2 text-[0.85rem] font-semibold text-ink">
          <Shield className="h-4 w-4 text-lav-700" /> Refund information
        </p>
        {refunded || displayedStatus === "refunded" ? (
          <p className="mt-2 flex items-center gap-2 text-[0.82rem] text-ink-2">
            <Check className="h-4 w-4 text-emerald-600" />
            {formatNaira(amount)} was returned to your wallet. It&apos;s already spendable.
          </p>
        ) : active && canRequestPreviewRefund ? (
          <>
            <p className="mt-2 text-[0.82rem] leading-relaxed text-ink-2">
              {expired
                ? "This simulated single-number order may be refunded if the window closed without a code."
                : "For this simulated single-number order, a refund can be requested after the window closes without a code."}
            </p>
            {expired && (
              <button
                type="button"
                onClick={requestRefund}
                disabled={pending}
                className="btn btn-dark mt-3.5 w-full !py-3 !text-[0.8rem] disabled:opacity-60"
              >
                {pending ? "Processing refund…" : `Request ${formatNaira(amount)} refund`}
                {!pending && <Refresh className="h-3.5 w-3.5" />}
              </button>
            )}
          </>
        ) : preview && provider === "simulated" ? (
          <p className="mt-2 text-[0.82rem] text-ink-2">
            {displayOtp ? "This demo code was delivered, so it is not eligible for a demo refund." : "This simulated order used demo funds. No real payment or refund is involved."}
          </p>
        ) : active || displayedStatus === "review" || displayedStatus === "processing" ? (
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
