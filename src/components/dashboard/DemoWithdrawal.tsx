"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Receipt, Shield, Wallet } from "@/components/icons";
import { DemoMoneyMovement } from "@/components/dashboard/DemoMoneyMovement";
import { formatNaira } from "@/lib/catalog";

type Withdrawal = { id: string; reference: string; amount: number; fee: number; createdAt: string };

export function DemoWithdrawal({ balance, userId, initialHistory }: { balance: number; userId: string; initialHistory: Withdrawal[] }) {
  const router = useRouter();
  const [history, setHistory] = useState(initialHistory);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshHistory() {
    try {
      const response = await fetch("/api/demo/wallet/withdraw", { cache: "no-store" });
      const data = await response.json() as { ok?: boolean; simulated?: boolean; withdrawals?: Withdrawal[] };
      if (!response.ok || !data.ok || !data.simulated || !Array.isArray(data.withdrawals)) throw new Error();
      setHistory(data.withdrawals);
      setError(null);
    } catch { setError("The demo withdrawal history could not be refreshed."); }
  }

  return <section id="withdraw" className="grid gap-3 scroll-mt-24">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-[1.05rem] font-semibold">Demo withdrawal</h2><p className="mt-0.5 text-[0.8rem] text-ink-2">Try a simulated payout to a fictional destination.</p></div><span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/70 px-2.5 py-1 text-[0.68rem] text-ink-3"><Wallet className="h-3 w-3 text-lav-600" /> {formatNaira(balance)} demo balance</span></div>
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
        <div className="rounded-xl bg-lav-50 p-3 text-[0.76rem] leading-relaxed text-lav-800"><p className="font-semibold">Fictional demo destination</p><p className="mt-1">No bank account details are collected and no money is transferred.</p></div>
        <button type="button" onClick={() => setOpen(true)} className="btn btn-primary mt-4 w-full !py-3"><ArrowUpRight className="h-4 w-4" /> Send demo money</button>
        <p className="mt-2 flex items-start gap-1.5 text-[0.68rem] text-ink-3"><Shield className="mt-0.5 h-3 w-3 shrink-0" /> Demo amounts are not real money. A simulated 1% fee applies above ₦5,000.</p>
      </div>
      <div className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5"><h3 className="flex items-center gap-2 text-[0.95rem] font-semibold"><Receipt className="h-4 w-4 text-lav-700" /> Demo withdrawal history</h3>{error && <p role="alert" className="mt-3 text-[0.78rem] text-rose-700">{error}</p>}{history.length === 0 ? <p className="mt-4 rounded-xl border border-dashed border-line p-5 text-center text-[0.78rem] text-ink-3">Your simulated withdrawals will appear here.</p> : <div className="mt-3 max-h-64 divide-y divide-line overflow-y-auto">{history.map((entry) => <div key={entry.id} className="flex justify-between gap-3 py-3"><div><p className="text-[0.85rem] font-semibold">{formatNaira(entry.amount)} <span className="text-[0.68rem] font-medium text-emerald-700">Demo complete</span></p><p className="mt-1 break-all text-[0.68rem] text-ink-3">{entry.reference}</p></div><p className="shrink-0 text-[0.68rem] text-ink-3">{new Date(entry.createdAt).toLocaleDateString("en-NG", { timeZone: "UTC" })}</p></div>)}</div>}</div>
    </div>
    {open && <DemoMoneyMovement kind="send" balance={balance} userId={userId} onClose={() => setOpen(false)} onCompleted={() => { router.refresh(); void refreshHistory(); }} />}
  </section>;
}
