"use client";

import { useEffect } from "react";
import { Check, Sparkle } from "@/components/icons";
import { fireConfetti } from "@/components/ui/Confetti";

interface PaymentSuccessProps {
  show: boolean;
  title?: string;
  message?: string;
  redirectUrl?: string;
  redirectDelay?: number;
  onRedirect?: () => void;
  /** Keep a receipt on screen when there is no destination to navigate to. */
  autoRedirect?: boolean;
  onClose?: () => void;
}

export function PaymentSuccess({
  show,
  title = "Payment successful",
  message = "Your order has been processed successfully.",
  redirectUrl = "/dashboard",
  redirectDelay = 2000,
  onRedirect,
  autoRedirect = true,
  onClose,
}: PaymentSuccessProps) {
  useEffect(() => {
    if (!show) return;
    fireConfetti();
    if (!autoRedirect) return;
    const timer = setTimeout(() => {
      if (onRedirect) onRedirect();
      else window.location.href = redirectUrl;
    }, redirectDelay);
    return () => clearTimeout(timer);
  }, [show, redirectUrl, redirectDelay, onRedirect, autoRedirect]);

  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="payment-success-title" aria-describedby="payment-success-message">
      <div className="flow-arrive relative w-full max-w-sm overflow-hidden rounded-[1.75rem] border border-white/80 bg-[#fffdfa] p-7 text-center shadow-float sm:p-9">
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-lav-200/60 blur-2xl" />
        <div aria-hidden="true" className="flow-pop relative mx-auto grid h-20 w-20 place-items-center rounded-[1.6rem] bg-emerald-100 text-emerald-700">
          <Check className="h-10 w-10" />
          <Sparkle className="absolute -right-2 -top-2 h-5 w-5 text-lav-600" />
        </div>
        <p className="mt-6 text-micro font-bold uppercase tracking-[0.18em] text-lav-700">All done</p>
        <h2 id="payment-success-title" className="mt-2 text-[1.45rem] font-semibold text-ink">{title}</h2>
        <p id="payment-success-message" className="mt-2 text-[0.84rem] leading-relaxed text-ink-2">{message}</p>
        {autoRedirect ? (
          <div className="mt-6">
            <p className="text-meta text-ink-3">Opening your details…</p>
            <div aria-hidden="true" className="mt-3 h-1.5 overflow-hidden rounded-full bg-lav-100"><div className="flow-progress h-full w-1/3 rounded-full bg-lav-600" /></div>
            <a href={redirectUrl} className="mt-4 inline-flex text-meta font-semibold text-lav-700 underline underline-offset-2">Continue now</a>
          </div>
        ) : (
          <button type="button" onClick={onClose} className="btn btn-primary mt-6 w-full">Done</button>
        )}
      </div>
    </div>
  );
}
