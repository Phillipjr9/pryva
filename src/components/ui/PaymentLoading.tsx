"use client";

import { useEffect, useState } from "react";
import { Lock, Shield } from "@/components/icons";
import { formatNaira } from "@/lib/catalog";
import { prefersReducedMotion } from "@/lib/motion";

interface PaymentLoadingProps {
  show: boolean;
  message?: string;
}

/**
 * The screen between "pay" and "paid".
 *
 * The old version was a white modal with a spinner and three bouncing dots: it
 * said "something is happening" and nothing else. A payment is the moment a
 * customer is most anxious, so this one answers the three questions they
 * actually have, in order, while the network does its work:
 *
 *   what is happening → what it costs → what happens if it fails
 *
 * The steps advance on a timer, but they are honest about it: the last step
 * stays put rather than pretending to finish, because the server, not the
 * animation, decides when the payment is done.
 */
export function PaymentLoading({
  show,
  message = "Processing your payment…",
}: PaymentLoadingProps) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!show) {
      setStep(0);
      return;
    }
    if (prefersReducedMotion()) {
      setStep(1);
      return;
    }
    const timers = [
      setTimeout(() => setStep(1), 900),
      setTimeout(() => setStep(2), 2200),
    ];
    return () => timers.forEach(clearTimeout);
  }, [show]);

  if (!show) return null;

  const steps = [
    "Securing the connection",
    "Contacting the payment provider",
    "Waiting for authorisation",
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4 backdrop-blur-[3px]"
      role="dialog"
      aria-modal="true"
      aria-label="Payment in progress"
    >
      <div className="pryva-rise w-full max-w-sm overflow-hidden rounded-[1.75rem] border border-ink bg-ink text-white shadow-[0_40px_90px_-40px_rgba(41,34,58,0.7)]">
        <div className="relative p-6">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-lav-500/25 blur-2xl"
          />
          <div className="relative flex items-center gap-2 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-lav-200/80">
            <Lock className="h-3 w-3" /> Secure checkout
          </div>

          <p className="relative mt-3 text-[1.02rem] font-semibold leading-snug">{message}</p>

          <div className="relative mt-5 h-1 overflow-hidden rounded-full bg-white/12">
            <div className="pryva-track h-full w-full rounded-full bg-gradient-to-r from-lav-300 via-lav-200 to-lav-300" />
          </div>

          <ol className="relative mt-5 space-y-2.5">
            {steps.map((label, index) => {
              const done = index < step;
              const active = index === step;
              return (
                <li
                  key={label}
                  className={`flex items-center gap-2.5 text-[0.78rem] transition-opacity duration-300 ${
                    done ? "text-white/55" : active ? "text-white" : "text-white/35"
                  }`}
                >
                  <span
                    className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[0.55rem] ${
                      done
                        ? "border-emerald-300/40 bg-emerald-400/20 text-emerald-200"
                        : active
                          ? "border-lav-300/60 bg-lav-300/20"
                          : "border-white/20"
                    }`}
                  >
                    {done ? "✓" : active ? <span className="h-1.5 w-1.5 rounded-full bg-lav-200" /> : ""}
                  </span>
                  {label}
                </li>
              );
            })}
          </ol>

          <p className="relative mt-5 flex items-start gap-1.5 rounded-xl bg-white/8 px-3 py-2 text-[0.68rem] leading-snug text-white/70">
            <Shield className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              You won&apos;t be charged twice. If the connection drops, the payment is either
              verified or refunded automatically.
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Amounts shown next to the paying overlay use the same naira formatting as the
 * rest of the app; exported so purchase forms can put the figure in the title
 * ("Paying ₦4,250") without re-implementing it.
 */
export const paymentTitle = (amount?: number) =>
  typeof amount === "number" && amount > 0 ? `Paying ${formatNaira(amount)}` : "Processing your payment…";
