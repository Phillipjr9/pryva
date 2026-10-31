import type { Metadata } from "next";
import Link from "next/link";
import { and, count, desc, eq, sum } from "drizzle-orm";
import { db } from "@/db";
import { walletTransactions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatNaira } from "@/lib/catalog";
import { walletEntryDirection, walletEntrySign } from "@/lib/wallet-activity";
import { TopUpForm } from "@/components/dashboard/TopUpForm";
import { ExportTransactionsButton } from "@/components/dashboard/ExportTransactionsButton";
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
  const paystackTestMode = process.env.PAYSTACK_SECRET_KEY?.trim().startsWith("sk_test_") ?? false;

  // Headline totals come from aggregates, not from the visible slice: the old
  // version summed the newest 40 rows and labelled them "in total".
  const [transactions, [creditRow], [refundRow], [spentRow], [debitCount]] = await Promise.all([
    db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.userId, user.id))
      .orderBy(desc(walletTransactions.createdAt))
      .limit(40),
    db
      .select({ value: sum(walletTransactions.amount) })
      .from(walletTransactions)
      .where(
        and(eq(walletTransactions.userId, user.id), eq(walletTransactions.type, "credit")),
      ),
    db
      .select({ value: sum(walletTransactions.amount) })
      .from(walletTransactions)
      .where(and(eq(walletTransactions.userId, user.id), eq(walletTransactions.type, "refund"))),
    db
      .select({ value: sum(walletTransactions.amount) })
      .from(walletTransactions)
      .where(and(eq(walletTransactions.userId, user.id), eq(walletTransactions.type, "debit"))),
    db
      .select({ value: count() })
      .from(walletTransactions)
      .where(and(eq(walletTransactions.userId, user.id), eq(walletTransactions.type, "debit"))),
  ]);

  const added = Number(creditRow?.value ?? 0) + Number(refundRow?.value ?? 0);
  const spent = Number(spentRow?.value ?? 0);
  const spendCount = Number(debitCount?.value ?? 0);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">Wallet</h1>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          Manage your balance and review your wallet activity.
        </p>
      </div>

      {paystackTestMode && <p role="note" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[0.8rem] leading-relaxed text-amber-900"><strong>Paystack test mode.</strong> Checkout and transfers are simulated by Paystack; no real payment is made. Use test data and a separate staging database.</p>}
      <TopUpReturn key={`${params.topup ?? ""}:${params.reference ?? params.trxref ?? ""}`} status={params.topup} reference={params.reference ?? params.trxref} userId={user.id} testMode={paystackTestMode} />

      <div className="grid gap-2.5 sm:grid-cols-3">
        <div className="rounded-2xl bg-ink p-5 text-white">
          <div className="flex items-center justify-between">
            <p className="text-micro uppercase tracking-[0.16em] text-white/55">Available now</p>
            <Wallet className="h-4 w-4 text-lav-200" />
          </div>
          <p className="mt-2 text-[1.9rem] font-semibold leading-none">
            {formatNaira(user.walletBalance)}
          </p>
          <p className="mt-2 text-micro text-white/55">See transaction history below</p>
        </div>
        <div className="rounded-2xl border border-line bg-[#fffdfa] p-5">
          <div className="flex items-center justify-between">
            <p className="text-micro uppercase tracking-[0.16em] text-ink-3">Added in total</p>
            <Card className="h-4 w-4 text-lav-600" />
          </div>
          <p className="mt-2 text-[1.55rem] font-semibold leading-none">{formatNaira(added)}</p>
          <p className="mt-2 text-micro text-ink-3">Credits and refunds (including gift-card redemptions)</p>
        </div>
        <div className="rounded-2xl border border-line bg-[#fffdfa] p-5">
          <div className="flex items-center justify-between">
            <p className="text-micro uppercase tracking-[0.16em] text-ink-3">Spent in total</p>
            <Refresh className="h-4 w-4 text-lav-600" />
          </div>
          <p className="mt-2 text-[1.55rem] font-semibold leading-none">{formatNaira(spent)}</p>
          <p className="mt-2 text-micro text-ink-3">{spendCount} purchase or gift-card charge{spendCount === 1 ? "" : "s"}; excludes withdrawals</p>
        </div>
      </div>

      {/* minmax(0,…) tracks: an implicit auto track is sized to its items’
          min-content, and a truncated transaction reference is wide enough to
          push the whole wallet past a 320px viewport. */}
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-start">
        <TopUpForm balance={user.walletBalance} userId={user.id} testMode={paystackTestMode} />

        <div className="grid min-w-0 grid-cols-1 gap-4">
          <div className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[1.05rem] font-semibold">Transaction history</h2>
              <div className="flex items-center gap-2.5">
                <span className="text-micro text-ink-3">{transactions.length} newest entries</span>
                {transactions.length > 0 && <ExportTransactionsButton />}
              </div>
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
                      <p className="truncate text-micro text-ink-3">
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
                          walletEntryDirection(tx.type) === "in" ? "text-emerald-600" : "text-ink-2"
                        }`}
                      >
                        {walletEntrySign(tx.type)}
                        {formatNaira(tx.amount)}
                      </p>
                      <p className="text-micro text-ink-3">Bal. {formatNaira(tx.balanceAfter)}</p>
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
                Top-ups use Paystack checkout.
              </li>
              <li className="flex items-start gap-2">
                <Refresh className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lav-600" />
                Order refunds require support review.
              </li>
              <li className="flex items-start gap-2">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lav-600" />
                Withdrawal requests reserve funds; rejected requests can be refunded.
              </li>
            </ul>
            <Link
              href="/dashboard/orders"
              className="mt-3.5 inline-flex items-center gap-1.5 text-meta font-semibold text-lav-700 hover:underline"
            >
              View your orders
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
      <WithdrawalDashboard balance={user.walletBalance} userId={user.id} testMode={paystackTestMode} />
    </div>
  );
}
