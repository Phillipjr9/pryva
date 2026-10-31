"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Clock, Copy } from "@/components/icons";
import { CountryFlag } from "@/components/CountryFlag";
import { formatNaira } from "@/lib/catalog";

export type LiveCode = {
  id: string;
  productName: string;
  planLabel: string;
  region: string;
  amount: number;
  referenceCode: string | null;
  otpCode: string | null;
  expiresAt: string | null;
  createdAt: string;
};

function remainingSeconds(expiresAt: string | null, now: number): number | null {
  if (!expiresAt) return null;
  const target = new Date(expiresAt).getTime();
  if (Number.isNaN(target)) return null;
  return Math.max(0, Math.round((target - now) / 1000));
}

function formatCountdown(seconds: number): string {
  // Rentals and eSIMs run for days. A mm:ss clock would read "5760:00", so
  // anything past an hour switches to a coarse unit instead.
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)}d left`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h left`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/**
 * The reason someone opens this dashboard: a code is on a timer and they need to
 * paste it somewhere. It gets its own card, a live countdown and a one-tap copy —
 * no navigating through Orders → order → copy.
 */
export function LiveCodeCard({ codes, initialNow }: { codes: LiveCode[]; initialNow: number }) {
  // The server timestamp is serialized with the page, so the first browser
  // render agrees with the HTML even if hydration happens seconds later.
  const [now, setNow] = useState(initialNow);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const withTime = useMemo(
    () =>
      codes.map((code) => ({
        ...code,
        secondsLeft: remainingSeconds(code.expiresAt, now),
      })),
    [codes, now],
  );

  async function copy(code: LiveCode, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(code.id);
    } catch {
      setCopied(null);
    }
  }

  return (
    <section aria-labelledby="live-codes-heading" className="grid min-w-0 grid-cols-1 gap-2.5">
      <div className="flex items-center justify-between">
        <h2 id="live-codes-heading" className="text-[1rem] font-semibold">
          Live now
        </h2>
        <Link
          href="/dashboard/orders"
          className="inline-flex items-center gap-1 text-meta font-semibold text-lav-700 hover:underline"
        >
          All orders <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {withTime.map((code) => {
        const expired = code.secondsLeft !== null && code.secondsLeft <= 0;
        const urgent = code.secondsLeft !== null && code.secondsLeft <= 120 && !expired;

        return (
          <div
            key={code.id}
            className="min-w-0 rounded-[1.5rem] border border-line bg-[#fffdfa] p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <CountryFlag region={code.region} size={24} decorative />
                <div className="min-w-0">
                  <p className="truncate text-[0.88rem] font-semibold text-ink">
                    {code.referenceCode ?? code.planLabel}
                  </p>
                  <p className="truncate text-meta text-ink-3">
                    {code.productName} · {code.planLabel} · {formatNaira(code.amount)}
                  </p>
                </div>
              </div>

              {code.secondsLeft === null ? (
                <span className="shrink-0 rounded-full bg-lav-50 px-2.5 py-1 text-micro font-semibold text-lav-700">
                  No expiry
                </span>
              ) : (
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-micro font-semibold tabular-nums ${
                    expired
                      ? "bg-amber-50 text-amber-700"
                      : urgent
                        ? "bg-amber-100 text-amber-800"
                        : "bg-emerald-50 text-emerald-700"
                  }`}
                >
                  <Clock className="h-3 w-3" />
                  {expired ? "Expired" : formatCountdown(code.secondsLeft)}
                </span>
              )}
            </div>

            {code.otpCode && (
              <div className="mt-3 flex items-stretch gap-2">
                <div className="flex flex-1 gap-1">
                  {code.otpCode.split("").map((digit, index) => (
                    <span
                      key={`${code.id}-${index}`}
                      className="otp-arrive grid h-10 flex-1 place-items-center rounded-lg border border-line bg-white text-[1.05rem] font-semibold tabular-nums text-ink"
                      style={{ animationDelay: `${index * 70}ms` }}
                    >
                      {digit}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => copy(code, code.otpCode ?? "")}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-ink px-3.5 text-meta font-semibold text-white transition-colors hover:bg-ink/90"
                  aria-label={`Copy code ${code.otpCode}`}
                >
                  {copied === code.id ? (
                    <>
                      <Check className="h-3.5 w-3.5" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </>
                  )}
                </button>
              </div>
            )}

            <div className="mt-3 flex items-center justify-between gap-3">
              <Link
                href={`/dashboard/orders/${code.id}`}
                className="text-meta font-semibold text-lav-700 hover:underline"
              >
                Open order
              </Link>
              {expired && !code.otpCode && (
                <span className="text-meta text-ink-3">
                  Contact support to review refund eligibility.
                </span>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
