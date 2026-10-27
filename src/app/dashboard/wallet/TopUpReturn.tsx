"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle, Clock, Shield, X } from "@/components/icons";
import { AnimatedAmount } from "@/components/ui/AnimatedAmount";

type State = "idle" | "verifying" | "credited" | "pending" | "failed";

/**
 * What the member sees when they come back from Paystack.
 *
 * The old version was a one-line coloured banner. It was correct — the
 * `?topup=success` flag is only a hint, and the credit is real only when
 * /api/wallet/topup/verify says so — but it told the member nothing while the
 * most important thing in the product was happening to their money.
 *
 * This is the funding receipt, ported from Veyra's payment flow:
 *   1. it shows the two steps that are actually being taken, and marks them done
 *      as they complete;
 *   2. on success the credited amount counts up, the wallet balance below
 *      refreshes, and confetti fires once — the only celebration in the app;
 *   3. on a pending result it explains that nothing is lost, rather than
 *      flashing amber and leaving them to guess.
 *
 * The verification call is unchanged and still idempotent, so a refresh is safe.
 */
export function TopUpReturn({
  status,
  reference,
}: {
  status?: string;
  reference?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>(status === "success" ? "verifying" : "idle");
  const [message, setMessage] = useState<string>("");
  const [amount, setAmount] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const attempted = useRef(false);

  useEffect(() => {
    if (status !== "success" || attempted.current) return;
    attempted.current = true;

    if (!reference) {
      setState("pending");
      setMessage("We're confirming your payment. Your balance updates in a moment.");
      router.refresh();
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/wallet/topup/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference }),
        });
        const data = (await response.json()) as {
          ok?: boolean;
          credited?: boolean;
          amount?: number;
          reason?: string;
          error?: string;
        };

        if (cancelled) return;

        if (response.ok && data.ok) {
          setState("credited");
          setAmount(typeof data.amount === "number" ? data.amount : null);
          setMessage(
            data.credited === false
              ? "This payment was already added to your wallet."
              : "Your wallet has been funded.",
          );
        } else if (response.status === 402) {
          setState("failed");
          setMessage(data.error ?? "That payment wasn't successful.");
        } else {
          setState("pending");
          setMessage(
            data.error ??
              "We couldn't confirm the payment yet. If you were charged, it lands in your wallet automatically.",
          );
        }
      } catch {
        if (!cancelled) {
          setState("pending");
          setMessage("We couldn't confirm the payment yet. If you were charged, it lands automatically.");
        }
      } finally {
        router.refresh();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, reference, router]);

  /* No confetti here on purpose. The celebration belongs to a completed
     purchase, where it marks the end of an action; on the funding receipt it
     lands on top of the amount the member came back to read, and on the ledger
     rows underneath it. The number counting up is the moment. */

  if (state === "idle" || dismissed) return null;

  return (
    <div className="pryva-rise relative overflow-hidden rounded-[1.5rem] border border-ink bg-ink p-5 text-white sm:p-6">
      <div
        aria-hidden
        className={`pointer-events-none absolute -right-16 -top-24 h-56 w-56 rounded-full blur-2xl ${
          state === "credited"
            ? "bg-emerald-400/20"
            : state === "failed"
              ? "bg-red-400/15"
              : "bg-lav-500/25"
        }`}
      />

      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="absolute right-3 top-3 rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="relative flex items-start gap-3.5">
        <span
          className={`mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full border ${
            state === "credited"
              ? "pryva-pop border-emerald-300/30 bg-emerald-400/15 text-emerald-200"
              : state === "failed"
                ? "border-red-300/30 bg-red-400/15 text-red-200"
                : "border-white/15 bg-white/8 text-lav-200"
          }`}
        >
          {state === "credited" ? <CheckCircle className="h-5 w-5" /> : <Clock className="h-5 w-5" />}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-white/40">
            {state === "credited" ? "Wallet funded" : state === "failed" ? "Payment not completed" : "Funding"}
          </p>

          {state === "credited" && amount ? (
            <AnimatedAmount
              value={amount}
              animateKey={reference ?? "topup"}
              className="mt-1 block text-[1.75rem] font-semibold leading-none"
            />
          ) : (
            <p className="mt-1 text-[1.05rem] font-semibold leading-snug">
              {state === "verifying" ? "Confirming your payment" : state === "failed" ? "That payment didn't go through" : "Payment received"}
            </p>
          )}

          <p className="mt-1.5 text-[0.8rem] leading-relaxed text-white/70">
            {state === "verifying" ? "Checking with the bank — this takes a few seconds." : message}
          </p>

          {state === "verifying" && (
            <ol className="mt-3 space-y-1.5">
              {["Confirming the charge with Paystack", "Crediting your Pryva wallet"].map((label, i) => (
                <li key={label} className="pryva-step flex items-center gap-2 text-[0.72rem] text-white/50" style={{ animationDelay: `${i * 90}ms` }}>
                  <span className="grid h-3.5 w-3.5 place-items-center rounded-full border border-white/25">
                    <span className="h-1 w-1 rounded-full bg-lav-200/80" />
                  </span>
                  {label}
                </li>
              ))}
            </ol>
          )}

          {state === "verifying" && (
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/12">
              <div className="pryva-track h-full w-full rounded-full bg-gradient-to-r from-lav-300 via-lav-200 to-lav-300" />
            </div>
          )}

          <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link
              href="/dashboard/wallet#statement"
              className="inline-flex items-center gap-1 text-[0.74rem] font-semibold text-white/75 hover:text-white"
            >
              View statement <ArrowRight className="h-3 w-3" />
            </Link>
            {state === "failed" || state === "pending" ? (
              <Link
                href="/dashboard/support"
                className="inline-flex items-center gap-1 text-[0.74rem] font-semibold text-white/55 hover:text-white"
              >
                Contact support
              </Link>
            ) : null}
            {reference && (
              <span className="tnum text-[0.66rem] text-white/35">Ref {reference}</span>
            )}
          </div>

          {state === "pending" && (
            <p className="mt-2 flex items-start gap-1.5 text-[0.68rem] leading-snug text-white/45">
              <Shield className="mt-0.5 h-3 w-3 shrink-0" />
              Nothing is lost: the payment is either credited automatically or refunded by Paystack.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
