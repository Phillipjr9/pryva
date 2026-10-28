"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Clock, Copy } from "@/components/icons";
import { CountryFlag } from "@/components/CountryFlag";
import { formatNaira } from "@/lib/catalog";
import { useDemoOtp } from "@/components/dashboard/useDemoOtp";

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
  service?: string;
  provider?: string | null;
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

function DemoCodeWatcher({ orderId, enabled }: { orderId: string; enabled: boolean }) {
  const { code, retrying } = useDemoOtp(orderId, enabled, null);
  const [copied, setCopied] = useState(false);
  const router = useRouter();
  useEffect(() => { if (code) router.refresh(); }, [code, router]);
  async function copyCode() {
    if (!code) return;
    try { await navigator.clipboard.writeText(code); setCopied(true); }
    catch { setCopied(false); }
  }
  if (!enabled && !code) return null;
  return (
    <div role="status" aria-live="polite" className="mt-3 rounded-xl border border-lav-100 bg-lav-50/60 p-3">
      <p className="text-[0.68rem] font-semibold text-lav-700">{code ? "Demo code received" : retrying ? "Checking again shortly…" : "Waiting for your demo code…"}</p>
      {code ? (
        <div className="mt-2 flex items-stretch gap-2">
          <div className="flex flex-1 gap-1" aria-label={`Demo code ${code}`}>
            {code.split("").map((digit, index) => <span key={index} aria-hidden="true" className="otp-arrive grid h-10 flex-1 place-items-center rounded-lg border border-lav-200 bg-white font-mono text-[1.05rem] font-semibold text-ink" style={{ animationDelay: `${index * 70}ms` }}>{digit}</span>)}
          </div>
          <button type="button" onClick={() => void copyCode()} className="rounded-lg bg-ink px-3 text-[0.72rem] font-semibold text-white">{copied ? "Copied" : "Copy"}</button>
        </div>
      ) : <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-lav-100"><div className="demo-progress h-full w-1/3 rounded-full bg-lav-500" /></div>}
    </div>
  );
}

/**
 * The reason someone opens this dashboard: a code is on a timer and they need to
 * paste it somewhere. It gets its own card, a live countdown and a one-tap copy —
 * no navigating through Orders → order → copy.
 */
export function LiveCodeCard({ codes, initialNow, preview = false }: { codes: LiveCode[]; initialNow: number; preview?: boolean }) {
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
          {preview ? "Demo codes" : "Live now"}
        </h2>
        <Link
          href="/dashboard/orders"
          className="inline-flex items-center gap-1 text-[0.74rem] font-semibold text-lav-700 hover:underline"
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
                  <p className="truncate text-[0.7rem] text-ink-3">
                    {code.productName} · {code.planLabel} · {formatNaira(code.amount)}
                  </p>
                </div>
              </div>

              {code.secondsLeft === null ? (
                <span className="shrink-0 rounded-full bg-lav-50 px-2.5 py-1 text-[0.62rem] font-semibold text-lav-700">
                  No expiry
                </span>
              ) : (
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[0.66rem] font-semibold tabular-nums ${
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

            {!code.otpCode && preview && code.provider === "simulated" && (code.service === "numbers" || code.service === "email-otp") && (
              <DemoCodeWatcher orderId={code.id} enabled={!expired} />
            )}
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
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-ink px-3.5 text-[0.76rem] font-semibold text-white transition-colors hover:bg-ink/90"
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
                className="text-[0.74rem] font-semibold text-lav-700 hover:underline"
              >
                Open order
              </Link>
              {expired && !code.otpCode && !preview && (
                <span className="text-[0.7rem] text-ink-3">
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
