import Link from "next/link";

import { formatNaira } from "@/lib/services/catalog";
import styles from "./BalanceHero.module.css";

/** The balance and its two money actions lead the dashboard. */
export function BalanceHero({
  name,
  balance,
  activeNumbers,
}: {
  name: string;
  balance: number;
  activeNumbers: number;
}) {
  return (
    <section
      aria-labelledby="balance-heading"
      className={`${styles.card} relative isolate overflow-hidden rounded-[1.75rem] border border-ink bg-ink p-5 text-white sm:p-6`}
    >
      {/* A quiet reflection and bevel give the surface depth without motion. */}
      <div aria-hidden="true" className={styles.sheen} />
      <div aria-hidden="true" className={styles.edge} />

      <div className="relative">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-micro font-semibold uppercase tracking-[0.16em] text-white/75">
               Available to spend
            </p>
            <h1
              id="balance-heading"
              className="mt-2 break-words text-[clamp(1.65rem,9.5vw,2.2rem)] font-semibold leading-none tracking-tight tabular-nums sm:text-[2.75rem]"
            >
              {formatNaira(balance)}
            </h1>
            <p className="mt-2 text-meta text-white/70">
              Hello {name} · your wallet and transaction history
            </p>
          </div>

          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Link
              href="/dashboard/wallet"
              className="btn min-w-max flex-1 whitespace-nowrap bg-white !px-4 !py-2.5 !text-[0.8125rem] font-semibold text-ink shadow-sm hover:bg-white/90 sm:flex-none"
            >
               Top up
            </Link>
            <Link
              href="/dashboard/wallet#withdraw"
              className="btn min-w-max flex-1 whitespace-nowrap border border-white/30 !px-4 !py-2.5 !text-[0.8125rem] font-semibold text-white hover:bg-white/10 sm:flex-none"
            >
               Withdraw
            </Link>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-white/15 pt-4">
          <dl>
            <div className="flex items-center gap-3">
              <dt className="text-meta font-semibold text-white">
                Active numbers
                <span className="mt-0.5 block text-micro font-normal text-white/70">Current rentals</span>
              </dt>
              <dd className="order-first grid min-h-10 min-w-10 place-items-center rounded-xl border border-white/15 bg-white/10 px-2.5 text-[1rem] font-semibold tabular-nums text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
                {activeNumbers.toLocaleString("en-NG")}
              </dd>
            </div>
          </dl>

          <Link
            href="/dashboard/wallet"
            className="inline-flex items-center gap-1 text-meta font-semibold text-white/80 hover:text-white"
          >
            Full wallet and statement
          </Link>
        </div>
      </div>
    </section>
  );
}
