"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Lock } from "@/components/icons";
import { formatNaira } from "@/lib/catalog";
import { PAYSTACK_TOPUP_UPDATED, forgetPaystackTopUp, notifyPaystackTopUpsChanged, readPendingPaystackTopUps, type PendingPaystackTopUp } from "@/lib/paystack-topup-intent";
import { PaystackTopUpFlow } from "@/components/dashboard/PaystackTopUpFlow";

export function TopUpForm({ balance, userId, testMode = false }: { balance: number; userId: string; testMode?: boolean }) {
  return <LiveTopUp balance={balance} userId={userId} testMode={testMode} />;
}

function LiveTopUp({ balance, userId, testMode }: { balance: number; userId: string; testMode: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<PendingPaystackTopUp[]>([]);
  const [storageState, setStorageState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    function restore() {
      try { setPending(readPendingPaystackTopUps(window.localStorage, userId)); setStorageState("ready"); }
      catch { setStorageState("unavailable"); }
    }
    restore();
    window.addEventListener("storage", restore);
    window.addEventListener("pageshow", restore);
    window.addEventListener(PAYSTACK_TOPUP_UPDATED, restore);
    return () => { window.removeEventListener("storage", restore); window.removeEventListener("pageshow", restore); window.removeEventListener(PAYSTACK_TOPUP_UPDATED, restore); };
  }, [userId]);

  function clearAfterReview(reference: string) {
    if (!window.confirm("Only clear this reference after checking the payment with Paystack, your wallet history and, if needed, support. Clearing it does not cancel checkout or stop a payment that is still in flight. Continue?")) return;
    try { forgetPaystackTopUp(window.localStorage, userId, reference); notifyPaystackTopUpsChanged(); }
    catch { setStorageState("unavailable"); }
  }

  return <>
    <section className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3"><h2 className="text-[1.05rem] font-semibold">Fund your wallet</h2><span className="rounded-full bg-cream px-2.5 py-1 text-[0.66rem] font-medium text-ink-2">Balance {formatNaira(balance)}</span></div>
      <p className="mt-3 text-[0.82rem] leading-relaxed text-ink-2">Review your top-up, then pay securely on Paystack. Choose from the payment methods available in its checkout.</p>
      {storageState === "unavailable" && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">Payment recovery storage is unavailable or unreadable. Enable browser storage or contact support before starting a new payment.</p>}
      {pending.length > 0 && <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[0.76rem] leading-relaxed text-amber-900">
        <p>A previous payment needs attention. Check its reference before paying again; clearing a reference does not cancel a payment.</p>
        <ul className="mt-2 grid gap-2">{pending.map((entry) => <li key={entry.reference} className="break-all">
          <strong>{formatNaira(entry.amount)} · {entry.reference}</strong><br />
          <Link className="font-semibold underline" href={`/dashboard/wallet?topup=return&reference=${encodeURIComponent(entry.reference)}`}>Check payment status</Link>
          <button type="button" className="ml-3 font-semibold underline" onClick={() => clearAfterReview(entry.reference)}>Clear after reconciliation</button>
        </li>)}</ul>
      </div>}
      <button type="button" onClick={() => setOpen(true)} disabled={storageState !== "ready" || pending.length > 0} className="btn btn-primary mt-4 w-full !whitespace-normal !py-3.5 !leading-snug disabled:opacity-50">Review a top-up <ArrowRight className="h-4 w-4" /></button>
      <p className="mt-3 flex items-start gap-1.5 text-[0.7rem] leading-relaxed text-ink-3"><Lock className="mt-0.5 h-3 w-3 shrink-0 text-lav-500" /> Your wallet is credited only after payment is confirmed. Payment credentials stay in Paystack checkout.</p>
    </section>
    {open && <PaystackTopUpFlow balance={balance} userId={userId} testMode={testMode} onClose={() => setOpen(false)} />}
  </>;
}
