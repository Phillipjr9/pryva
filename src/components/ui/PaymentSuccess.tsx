"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle, Copy } from "@/components/icons";
import { fireConfetti } from "@/components/ui/Confetti";
import { formatNaira } from "@/lib/catalog";
import { prefersReducedMotion } from "@/lib/motion";

interface PaymentSuccessProps {
  show: boolean;
  title?: string;
  message?: string;
  redirectUrl?: string;
  redirectDelay?: number;
  onRedirect?: () => void;
  /** What was paid. Rendered as the receipt's headline figure when supplied. */
  amount?: number;
  /** Order reference, shown in tabular type so it can be read aloud or copied. */
  reference?: string;
}

/**
 * The moment after paying.
 *
 * Veyra's version of this screen was the single most reused piece of its design:
 * a dark receipt that states the amount, the reference and what happens next,
 * rather than a tick and the word "Success". Pryva's old one was a white modal
 * with `animate-in` classes whose plugin was never installed — so the "success"
 * simply appeared, with no motion at all.
 *
 * What this does:
 * - lands the receipt from below, then the tick pops (spring curve, not linear);
 * - puts the amount first, because that is the thing being checked;
 * - shows the reference with a copy control, because support asks for it;
 * - drains a progress bar for the redirect, so the exit is expected;
 * - respects `prefers-reduced-motion` — and still redirects either way.
 *
 * The redirect behaviour and props are unchanged, so every existing purchase
 * form picks this up without edits.
 */
export function PaymentSuccess({
  show,
  title = "Payment successful",
  message = "Your order has been processed.",
  redirectUrl = "/dashboard",
  redirectDelay = 2000,
  onRedirect,
  amount,
  reference,
}: PaymentSuccessProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!show) {
      setCopied(false);
      return;
    }
    if (!prefersReducedMotion()) fireConfetti();

    const timer = setTimeout(() => {
      if (onRedirect) onRedirect();
      else window.location.href = redirectUrl;
    }, redirectDelay);
    return () => clearTimeout(timer);
  }, [show, redirectUrl, redirectDelay, onRedirect]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!show) return null;

  async function copyReference() {
    if (!reference) return;
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4 backdrop-blur-[3px]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="pryva-rise w-full max-w-sm overflow-hidden rounded-[1.75rem] border border-ink bg-ink text-white shadow-[0_40px_90px_-40px_rgba(41,34,58,0.7)]">
        <div className="relative p-6 text-center">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-14 -top-20 h-48 w-48 rounded-full bg-emerald-400/20 blur-2xl"
          />

          <span className="pryva-pop relative mx-auto grid h-14 w-14 place-items-center rounded-full border border-emerald-300/30 bg-emerald-400/15">
            <CheckCircle className="h-7 w-7 text-emerald-200" />
          </span>

          <p className="relative mt-4 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-white/45">
            Receipt
          </p>

          {typeof amount === "number" && amount > 0 ? (
            <p className="tnum relative mt-1 text-[2rem] font-semibold leading-none">{formatNaira(amount)}</p>
          ) : null}

          <h2 className="pryva-step relative mt-2 text-[1.02rem] font-semibold">{title}</h2>
          <p className="pryva-step relative mt-1.5 text-[0.8rem] leading-relaxed text-white/65" style={{ animationDelay: "60ms" }}>
            {message}
          </p>

          {reference && (
            <div className="relative mt-4 flex items-center justify-between gap-2 rounded-xl bg-white/8 px-3 py-2 text-left">
              <div className="min-w-0">
                <p className="text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-white/40">Reference</p>
                <p className="tnum truncate text-[0.76rem] font-medium text-white/90">{reference}</p>
              </div>
              <button
                type="button"
                onClick={copyReference}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white/12 px-2 py-1 text-[0.66rem] font-semibold text-white transition-colors hover:bg-white/20"
                aria-label="Copy reference"
              >
                <Copy className="h-3 w-3" />
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}

          <div className="relative mt-5 h-1 overflow-hidden rounded-full bg-white/12">
            <div
              className="h-full rounded-full bg-emerald-300/80"
              style={{
                animation: `pryvaDrain ${redirectDelay}ms linear forwards`,
              }}
            />
          </div>
          <p className="relative mt-2 text-[0.66rem] text-white/45">Taking you to your dashboard…</p>

          <Link
            href={redirectUrl}
            className="relative mt-4 inline-flex items-center gap-1 text-[0.72rem] font-semibold text-white/75 hover:text-white"
          >
            Skip the wait <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      <style>{`
        @keyframes pryvaDrain { from { width: 0% } to { width: 100% } }
        @media (prefers-reduced-motion: reduce) { @keyframes pryvaDrain { from { width: 100% } to { width: 100% } } }
      `}</style>
    </div>
  );
}
