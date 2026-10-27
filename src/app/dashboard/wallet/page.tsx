import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { walletTransactions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatNaira } from "@/lib/catalog";
import { TopUpForm } from "@/components/dashboard/TopUpForm";
import { WithdrawalDashboard } from "./WithdrawalDashboard";
import { TopUpReturn } from "./TopUpReturn";
import { ArrowRight, Card, Check, Clock, Refresh, Shield, Wallet } from "@/components/icons";

export const metadata: Metadata = { title: "Wallet" };
export const dynamic = "force-dynamic";

export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<{ topup?: string; reference?: string; trxref?: string }>;
}) {
  const user = await requireUser("/dashboard/wallet");
  const params = await searchParams;

  const transactions = await db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.id))
    .orderBy(desc(walletTransactions.createdAt))
    .limit(40);

  const added = transactions
    .filter((tx: { type: string }) => tx.type !== "debit")
    .reduce((sum: number, tx: { amount: number }) => sum + tx.amount, 0);
  const spent = transactions
    .filter((tx: { type: string }) => tx.type === "debit")
    .reduce((sum: number, tx: { amount: number }) => sum + tx.amount, 0);

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">Wallet</h1>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          Fund in Naira, spend on any Pryva service. Refunds land back here automatically.
        </p>
      </div>

      <TopUpReturn status={params.topup} reference={params.reference ?? params.trxref} />

      <div className="grid gap-2.5 sm:grid-cols-3">
        <div className="rounded-2xl bg-ink p-5 text-white">
          <div className="flex items-center justify-between">
            <p className="text-[0.64rem] uppercase tracking-[0.16em] text-white/55">Available now</p>
            <Wallet className="h-4 w-4 text-lav-200" />
          </div>
          <p className="mt-2 text-[1.9rem] font-semibold leading-none">
            {formatNaira(user.walletBalance)}
          </p>
          <p className="mt-2 text-[0.68rem] text-white/55">Valid for 90 days from last activity</p>
        </div>
        <div className="rounded-2xl border border-line bg-[#fffdfa] p-5">
          <div className="flex items-center justify-between">
            <p className="text-[0.64rem] uppercase tracking-[0.16em] text-ink-3">Added in total</p>
            <Card className="h-4 w-4 text-lav-600" />
          </div>
          <p className="mt-2 text-[1.55rem] font-semibold leading-none">{formatNaira(added)}</p>
          <p className="mt-2 text-[0.68rem] text-ink-3">Top-ups, welcome and refund credits</p>
        </div>
        <div className="rounded-2xl border border-line bg-[#fffdfa] p-5">
          <div className="flex items-center justify-between">
            <p className="text-[0.64rem] uppercase tracking-[0.16em] text-ink-3">Spent in total</p>
            <Refresh className="h-4 w-4 text-lav-600" />
          </div>
          <p className="mt-2 text-[1.55rem] font-semibold leading-none">{formatNaira(spent)}</p>
          <p className="mt-2 text-[0.68rem] text-ink-3">Across {transactions.filter((tx: { type: string }) => tx.type === "debit").length} orders</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
        <TopUpForm balance={user.walletBalance} />

        <div className="grid gap-4">
          <div className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[1.05rem] font-semibold">Transaction history</h2>
              <span className="text-[0.68rem] text-ink-3">{transactions.length} entries</span>
            </div>
            {transactions.length === 0 ? (
              <p className="mt-4 rounded-xl border border-dashed border-line bg-cream/50 px-4 py-6 text-center text-[0.82rem] text-ink-3">
                Your first top-up will show up here.
              </p>
            ) : (
              <div className="mt-3 max-h-[26rem] divide-y divide-line/80 overflow-y-auto pr-1">
                {transactions.map((tx: { id: string; description: string; amount: number; type: string; balanceAfter: number; reference: string; createdAt: Date | string }) => (
                  <div key={tx.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-[0.82rem] font-medium text-ink">{tx.description}</p>
                      <p className="truncate text-[0.66rem] text-ink-3">
                        {tx.reference} ·{" "}
                        {new Date(tx.createdAt).toLocaleString("en-NG", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className={`text-[0.82rem] font-semibold ${
                          tx.type === "debit" ? "text-ink-2" : "text-emerald-600"
                        }`}
                      >
                        {tx.type === "debit" ? "−" : "+"}
                        {formatNaira(tx.amount)}
                      </p>
                      <p className="text-[0.64rem] text-ink-3">Bal. {formatNaira(tx.balanceAfter)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-[1.5rem] border border-lav-200 bg-gradient-to-br from-lav-50 to-white p-5">
            <p className="flex items-center gap-2 text-[0.85rem] font-semibold text-ink">
              <Shield className="h-4 w-4 text-lav-700" /> How money moves
            </p>
            <ul className="mt-2.5 grid gap-2 text-[0.8rem] text-ink-2">
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lav-600" />
                Bank transfer or local card. No dollar card needed.
              </li>
              <li className="flex items-start gap-2">
                <Refresh className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lav-600" />
                Refunds are automatic when a code doesn&apos;t arrive.
              </li>
              <li className="flex items-start gap-2">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lav-600" />
                Balance stays valid for 90 days from last activity.
              </li>
            </ul>
            <Link
              href="/dashboard/orders"
              className="mt-3.5 inline-flex items-center gap-1.5 text-[0.78rem] font-semibold text-lav-700 hover:underline"
            >
              View your orders
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
      <div id="withdraw" className="scroll-mt-24">
        <WithdrawalDashboard />
      </div>
    </div>
  );
}
