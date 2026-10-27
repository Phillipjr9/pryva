import type { ReactNode } from "react";
import Link from "next/link";
import { Check, Shield, Sparkle } from "@/components/icons";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-cream">
      <div className="pointer-events-none absolute left-[-10rem] top-[-10rem] h-[30rem] w-[30rem] rounded-full bg-lav-200/45 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-[-12rem] right-[-6rem] h-[28rem] w-[28rem] rounded-full bg-peach/50 blur-[120px]" />

      <header className="shell relative flex h-[76px] items-center justify-end">
        <Link
          href="/"
          className="text-[0.8rem] font-medium text-ink-2 transition-colors hover:text-lav-700"
        >
          Back to site
        </Link>
      </header>

      <div className="shell relative grid gap-10 pb-16 pt-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:gap-16 lg:pt-10">
        <div className="order-2 hidden lg:order-1 lg:block">
          <div className="relative overflow-hidden rounded-[2rem] border border-white/80 bg-white/60 p-8 shadow-[var(--shadow-card)] backdrop-blur">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-lav-200 bg-white/80 px-3 py-1.5 text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-lav-700">
              <Sparkle className="h-3 w-3" /> Simple. Secure. Scalable.
            </span>
            <h2 className="mt-5 max-w-sm text-[1.9rem] font-medium leading-[1.1]">
              Secure solutions.
              <br />
              <span className="text-display italic text-lav-700">Simple experience.</span>
            </h2>
            <p className="mt-3 max-w-sm text-[0.88rem] leading-relaxed text-ink-2">
              Numbers, eSIM data, residential proxies and temporary inboxes — one Naira wallet, one
              calm dashboard.
            </p>

            <div className="mt-7 grid gap-2.5">
              {[
                { title: "Pay in Naira", body: "Bank transfer or local card, no dollar cards." },
                { title: "Instant delivery", body: "Codes and credentials appear immediately." },
                { title: "Auto-refund", body: "No code? The amount returns to your wallet." },
              ].map((item) => (
                <div
                  key={item.title}
                  className="flex items-start gap-3 rounded-2xl border border-line bg-white/80 px-4 py-3"
                >
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-lav-50 text-lav-700">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <p className="text-[0.84rem] font-semibold text-ink">{item.title}</p>
                    <p className="text-[0.76rem] text-ink-2">{item.body}</p>
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-6 flex items-center gap-2 text-[0.72rem] text-ink-3">
              <Shield className="h-3.5 w-3.5 text-lav-600" />
              Carrier-grade infrastructure · operated from Lagos, Nigeria
            </p>
          </div>
        </div>

        <div className="order-1 lg:order-2">{children}</div>
      </div>
    </div>
  );
}
