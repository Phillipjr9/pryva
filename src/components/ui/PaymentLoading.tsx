"use client";

import { Card, Lock } from "@/components/icons";

interface PaymentLoadingProps {
  show: boolean;
  message?: string;
}

/** A calm, branded waiting state; it never claims success before the API does. */
export function PaymentLoading({ show, message = "Processing your payment…" }: PaymentLoadingProps) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/55 p-4 backdrop-blur-sm" role="status" aria-live="polite" aria-busy="true">
      <div className="demo-arrive w-full max-w-sm overflow-hidden rounded-[1.75rem] border border-white/80 bg-[#fffdfa] p-7 text-center shadow-float sm:p-9">
        <div aria-hidden="true" className="relative mx-auto grid h-28 w-28 place-items-center">
          <span className="demo-breathe absolute inset-2 rounded-full bg-lav-200" />
          <span className="demo-orbit absolute inset-0 rounded-full border-2 border-lav-100 border-t-lav-600" />
          <span className="relative grid h-16 w-16 place-items-center rounded-[1.3rem] bg-ink text-white shadow-lg"><Card className="h-7 w-7" /></span>
        </div>
        <p className="mt-6 text-[0.63rem] font-bold uppercase tracking-[0.18em] text-lav-700">Just a moment</p>
        <h2 className="mt-2 text-[1.45rem] font-semibold text-ink">Processing payment</h2>
        <p className="mt-2 text-[0.84rem] leading-relaxed text-ink-2">{message}</p>
        <div aria-hidden="true" className="mt-6 h-1.5 overflow-hidden rounded-full bg-lav-100">
          <div className="demo-progress h-full w-1/3 rounded-full bg-lav-600" />
        </div>
        <p className="mt-4 inline-flex items-center gap-1.5 text-[0.68rem] text-ink-3"><Lock className="h-3 w-3" /> Please keep this page open</p>
      </div>
    </div>
  );
}
