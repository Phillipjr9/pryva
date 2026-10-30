import Link from "next/link";
import { ArrowRight, ArrowUpRight, Plus, Wallet } from "@/components/icons";
import { formatNaira } from "@/lib/catalog";

export type BalanceStat = {
  label: string;
  value: string;
  note?: string;
};

/**
 * The first thing on the dashboard.
 *
 * The balance is what people open this page for — whether there is enough left
 * to buy, and whether a refund has landed. It used to sit below a greeting, a
 * banner and a live-code block; now it leads, with the two money actions
 * attached to it so topping up never needs a second decision.
 */
export function BalanceHero({
  name,
  balance,
  stats,
}: {
  name: string;
  balance: number;
  stats: BalanceStat[];
}) {
  return (
    <section
      aria-labelledby="balance-heading"
      className="relative overflow-hidden rounded-[1.75rem] border border-ink bg-ink p-5 text-white sm:p-6"
    >
      {/* Depth without a background image: one soft violet bloom, one hairline. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-lav-500/25 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
      />

      <div className="relative">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-micro font-semibold uppercase tracking-[0.16em] text-white/55">
              <Wallet className="h-3.5 w-3.5" /> Available to spend
            </p>
            <h1
              id="balance-heading"
              className="mt-2 text-[2.2rem] font-semibold leading-none tracking-tight tabular-nums sm:text-[2.75rem]"
            >
              {formatNaira(balance)}
            </h1>
            <p className="mt-2 text-meta text-white/55">
              Hello {name} · your wallet and transaction history
            </p>
          </div>

          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Link
              href="/dashboard/wallet"
              className="btn flex-1 bg-white !px-4 !py-2.5 !text-[0.8rem] font-semibold text-ink shadow-sm hover:bg-white/90 sm:flex-none"
            >
              <Plus className="h-3.5 w-3.5" /> Top up
            </Link>
            <Link
              href="/dashboard/wallet#withdraw"
              className="btn flex-1 border border-white/25 !px-4 !py-2.5 !text-[0.8rem] font-semibold text-white hover:bg-white/10 sm:flex-none"
            >
              <ArrowUpRight className="h-3.5 w-3.5" /> Withdraw
            </Link>
          </div>
        </div>

        {/* One column on a phone: three columns of truncated money at 320 px
            hide the balance, which is the number the page exists to show. */}
        <dl className="mt-5 grid grid-cols-1 gap-3 border-t border-white/10 pt-4 sm:grid-cols-3 sm:gap-2">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt className="text-micro uppercase tracking-[0.12em] text-white/45">
                {stat.label}
              </dt>
              <dd className="mt-1 truncate text-[0.95rem] font-semibold tabular-nums">
                {stat.value}
              </dd>
              {stat.note && <p className="mt-0.5 truncate text-micro text-white/40">{stat.note}</p>}
            </div>
          ))}
        </dl>

        <Link
          href="/dashboard/wallet"
          className="mt-3 inline-flex items-center gap-1 text-meta font-semibold text-white/70 hover:text-white"
        >
          Full wallet and statement <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </section>
  );
}
