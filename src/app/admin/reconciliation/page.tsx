import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/db";
import { orders, paymentTopups, withdrawals } from "@/db/schema";
import { asc, eq, inArray, isNotNull } from "drizzle-orm";
import { ageHours, ageSeverity, formatAge, type AgeSeverity } from "@/lib/reconciliation-queue";
import { ledgerBreaks, recentReconciliationRuns } from "@/lib/daily-reconciliation";

export const dynamic = "force-dynamic";

/**
 * Everything that is waiting for a person because no code will finish it.
 *
 * Three classes, deliberately separated because the action differs:
 *
 *   1. money already in flight (a withdrawal whose transfer outcome is unknown,
 *      an order whose supplier outcome is unknown);
 *   2. deposits that were started and never confirmed;
 *   3. refunds that committed while the supplier unit may still be live.
 *
 * The page is read-only. Every action lives on the page that owns it, because
 * this screen must not become a second, unaudited way to move money.
 *
 * Nothing here names a supplier, stores credentials or shows a full account
 * number: an operator gets the reference to check with the provider, and the
 * bank name to recognise it, which is what reconciliation needs.
 */

const LIST_LIMIT = 50;
const PENDING_TOPUP_GRACE_HOURS = 1;

const SEVERITY_STYLES: Record<AgeSeverity, string> = {
  fresh: "bg-slate-100 text-slate-600",
  watch: "bg-amber-50 text-amber-700",
  urgent: "bg-red-50 text-red-700",
};

function formatNaira(amount: number) {
  return `₦${amount.toLocaleString("en-NG")}`;
}

function formatDate(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString("en-NG", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AgeBadge({ since }: { since: Date | string }) {
  const hours = ageHours(since);
  const severity = ageSeverity(hours);
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-meta font-semibold ${SEVERITY_STYLES[severity]}`}>
      {formatAge(hours)}
    </span>
  );
}

function Section({
  title,
  description,
  count,
  children,
}: {
  title: string;
  description: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[1.05rem] font-medium tracking-tight">{title}</h2>
        <span className="text-[0.8rem] text-ink-3">
          {count} {count === 1 ? "item" : "items"}
        </span>
      </div>
      <p className="max-w-3xl text-[0.82rem] text-ink-2">{description}</p>
      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[36rem] text-left text-[0.84rem]">
          <thead className="bg-cream/70 text-meta uppercase tracking-wide text-ink-3">
            <tr>
              <th className="px-4 py-3 font-semibold">Reference</th>
              <th className="px-4 py-3 font-semibold">Detail</th>
              <th className="px-4 py-3 font-semibold">Amount</th>
              <th className="px-4 py-3 font-semibold">Age</th>
              <th className="px-4 py-3 font-semibold">Opened</th>
            </tr>
          </thead>
          <tbody>
            {children}
            {count === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-2">
                  Nothing here. That is the good outcome.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function AdminReconciliationPage() {
  await requireAdmin("/admin/reconciliation");

  const [processingWithdrawals, pendingWithdrawals, unresolvedOrders, flaggedOrders, pendingTopups, dailyRuns, breaks] =
    await Promise.all([
      db
        .select({
          id: withdrawals.id,
          reference: withdrawals.reference,
          amount: withdrawals.amount,
          fee: withdrawals.fee,
          bankName: withdrawals.bankName,
          status: withdrawals.status,
          failureReason: withdrawals.failureReason,
          createdAt: withdrawals.createdAt,
        })
        .from(withdrawals)
        .where(eq(withdrawals.status, "processing"))
        .orderBy(asc(withdrawals.createdAt))
        .limit(LIST_LIMIT),
      db
        .select({ id: withdrawals.id })
        .from(withdrawals)
        .where(eq(withdrawals.status, "pending"))
        .limit(1_000),
      db
        .select({
          id: orders.id,
          reference: orders.reference,
          productName: orders.productName,
          amount: orders.amount,
          status: orders.status,
          providerRequestId: orders.providerRequestId,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .where(inArray(orders.status, ["processing", "review"]))
        .orderBy(asc(orders.createdAt))
        .limit(LIST_LIMIT),
      db
        .select({
          id: orders.id,
          reference: orders.reference,
          productName: orders.productName,
          amount: orders.amount,
          reconciliationNote: orders.reconciliationNote,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .where(isNotNull(orders.reconciliationNote))
        .orderBy(asc(orders.createdAt))
        .limit(LIST_LIMIT),
      db
        .select({
          reference: paymentTopups.reference,
          amount: paymentTopups.amount,
          status: paymentTopups.status,
          createdAt: paymentTopups.createdAt,
        })
        .from(paymentTopups)
        .where(eq(paymentTopups.status, "pending"))
        .orderBy(asc(paymentTopups.createdAt))
        .limit(LIST_LIMIT * 4),
      recentReconciliationRuns(14),
      ledgerBreaks(25),
    ]);

  // A deposit that has been pending for a few minutes is an ordinary checkout in
  // progress. One that has been pending for an hour is either an abandoned
  // checkout or a payment the customer made and we never confirmed, and only
  // Paystack can tell the two apart.
  const staleTopups = pendingTopups.filter(
    (topup) => ageHours(topup.createdAt) >= PENDING_TOPUP_GRACE_HOURS,
  );

  const urgent =
    processingWithdrawals.filter((row) => ageSeverity(ageHours(row.createdAt)) === "urgent").length +
    unresolvedOrders.filter((row) => ageSeverity(ageHours(row.createdAt)) === "urgent").length +
    flaggedOrders.filter((row) => ageSeverity(ageHours(row.createdAt)) === "urgent").length;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.5rem] font-medium tracking-tight">Reconciliation</h1>
          <p className="mt-1 max-w-3xl text-[0.86rem] text-ink-2">
            Money and orders whose outcome no code can decide. Check each one with the provider
            before changing anything; an unknown outcome is not a failure.
          </p>
        </div>
        <div className={`rounded-xl border px-4 py-2 text-right ${urgent > 0 ? "border-red-200 bg-red-50" : "border-line bg-white"}`}>
          <p className="text-meta uppercase tracking-wide text-ink-3">Older than a day</p>
          <p className={`text-[1rem] font-semibold ${urgent > 0 ? "text-red-700" : "text-ink"}`}>{urgent}</p>
        </div>
      </div>

      <Section
        title="Withdrawals in flight"
        description="The transfer was initiated, so money may already have left. Completion requires the Paystack reference, an explicit confirmation and a note. Rejecting these would refund a payout that may still arrive."
        count={processingWithdrawals.length}
      >
        {processingWithdrawals.map((row) => (
          <tr key={row.id} className="border-t border-line/70 align-top">
            <td className="px-4 py-3 font-mono text-meta text-ink-2">{row.reference}</td>
            <td className="px-4 py-3">
              <p className="text-ink">{row.bankName}</p>
              <p className="text-meta text-ink-3">{row.failureReason ?? "No review note recorded"}</p>
            </td>
            <td className="px-4 py-3 whitespace-nowrap">{formatNaira(row.amount + row.fee)}</td>
            <td className="px-4 py-3"><AgeBadge since={row.createdAt} /></td>
            <td className="px-4 py-3 whitespace-nowrap text-meta text-ink-3">{formatDate(row.createdAt)}</td>
          </tr>
        ))}
      </Section>

      <div className="flex flex-wrap items-center gap-3 text-[0.82rem] text-ink-2">
        <Link href="/admin/withdrawals" className="btn btn-ghost btn-sm">Open withdrawals</Link>
        <span>{pendingWithdrawals.length >= 1_000 ? "1,000+" : pendingWithdrawals.length} awaiting approval (not listed here)</span>
      </div>

      <Section
        title="Orders with an unknown supplier outcome"
        description="Fulfilment was attempted and the result could not be confirmed. Reconcile by the provider reference before refunding or retrying; a blind retry can buy the same item twice. Review orders are unsourceable and still need a refund decision."
        count={unresolvedOrders.length}
      >
        {unresolvedOrders.map((row) => (
          <tr key={row.id} className="border-t border-line/70 align-top">
            <td className="px-4 py-3 font-mono text-meta text-ink-2">{row.reference}</td>
            <td className="px-4 py-3">
              <p className="text-ink">{row.productName}</p>
              <p className="text-meta text-ink-3">
                {row.status === "review" ? "Unsourceable — refund decision pending" : "Outcome unknown — provider reference recorded"}
                {row.providerRequestId ? ` · ${row.providerRequestId}` : ""}
              </p>
            </td>
            <td className="px-4 py-3 whitespace-nowrap">{formatNaira(row.amount)}</td>
            <td className="px-4 py-3"><AgeBadge since={row.createdAt} /></td>
            <td className="px-4 py-3 whitespace-nowrap text-meta text-ink-3">{formatDate(row.createdAt)}</td>
          </tr>
        ))}
      </Section>

      <Section
        title="Refunded, but the unit may still be live"
        description="The customer was credited and the upstream unit could not be released. This is recorded exposure, not a task to close: keep it visible until the provider confirms the unit is gone."
        count={flaggedOrders.length}
      >
        {flaggedOrders.map((row) => (
          <tr key={row.id} className="border-t border-line/70 align-top">
            <td className="px-4 py-3 font-mono text-meta text-ink-2">{row.reference}</td>
            <td className="px-4 py-3">
              <p className="text-ink">{row.productName}</p>
              <p className="text-meta text-ink-3">{row.reconciliationNote}</p>
            </td>
            <td className="px-4 py-3 whitespace-nowrap">{formatNaira(row.amount)}</td>
            <td className="px-4 py-3"><AgeBadge since={row.createdAt} /></td>
            <td className="px-4 py-3 whitespace-nowrap text-meta text-ink-3">{formatDate(row.createdAt)}</td>
          </tr>
        ))}
      </Section>

      <Section
        title="Deposits started but never confirmed"
        description="Pending for more than an hour. A checkout the customer abandoned and a payment we failed to confirm look identical here; only Paystack can tell them apart. Never credit on a customer's word, and never replay an old event."
        count={staleTopups.length}
      >
        {staleTopups.map((row) => (
          <tr key={row.reference} className="border-t border-line/70 align-top">
            <td className="px-4 py-3 font-mono text-meta text-ink-2">{row.reference}</td>
            <td className="px-4 py-3 text-[0.8rem] text-ink-3">
              Check this reference in the Paystack dashboard before doing anything
            </td>
            <td className="px-4 py-3 whitespace-nowrap">{formatNaira(row.amount)}</td>
            <td className="px-4 py-3"><AgeBadge since={row.createdAt} /></td>
            <td className="px-4 py-3 whitespace-nowrap text-meta text-ink-3">{formatDate(row.createdAt)}</td>
          </tr>
        ))}
      </Section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[1.05rem] font-medium tracking-tight">Daily close</h2>
          <span className="text-[0.8rem] text-ink-3">last {dailyRuns.length} days</span>
        </div>
        <p className="max-w-3xl text-[0.82rem] text-ink-2">
          The nightly job records each day&apos;s totals and checks every account&apos;s ledger for
          continuity: each transaction&apos;s balance must follow from the one before it, and the last
          one must equal the balance on the account. A day marked{" "}
          <span className="font-semibold text-red-700">attention</span> means the wallet ledger did
          not add up and needs a person.
        </p>
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[44rem] text-left text-[0.84rem]">
            <thead className="bg-cream/70 text-meta uppercase tracking-wide text-ink-3">
              <tr>
                <th className="px-4 py-3 font-semibold">Day</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Deposits</th>
                <th className="px-4 py-3 font-semibold">Spend</th>
                <th className="px-4 py-3 font-semibold">Refunds</th>
                <th className="px-4 py-3 font-semibold">Withdrawals</th>
                <th className="px-4 py-3 font-semibold">Accounts</th>
              </tr>
            </thead>
            <tbody>
              {dailyRuns.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-ink-2">
                    No close has run yet. It runs nightly at 02:20 Lagos time; a day can be
                    backfilled by calling the cron endpoint with <code>?day=YYYY-MM-DD</code>.
                  </td>
                </tr>
              )}
              {dailyRuns.map((run) => {
                const totals = (run.totals ?? {}) as {
                  topupsPaid?: { amount?: number };
                  ordersPlaced?: { amount?: number };
                  refunds?: { amount?: number };
                  withdrawalsCompleted?: { amount?: number };
                };
                return (
                  <tr key={run.id} className="border-t border-line/70">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-meta text-ink-2">
                      {String(run.day)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-meta font-semibold ${
                          run.status === "clean"
                            ? "bg-emerald-50 text-emerald-700"
                            : run.status === "running"
                              ? "bg-slate-100 text-slate-600"
                              : "bg-red-50 text-red-700"
                        }`}
                      >
                        {run.status}
                        {run.discrepancies > 0 ? ` · ${run.discrepancies}` : ""}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{formatNaira(totals.topupsPaid?.amount ?? 0)}</td>
                    <td className="whitespace-nowrap px-4 py-3">{formatNaira(totals.ordersPlaced?.amount ?? 0)}</td>
                    <td className="whitespace-nowrap px-4 py-3">{formatNaira(totals.refunds?.amount ?? 0)}</td>
                    <td className="whitespace-nowrap px-4 py-3">{formatNaira(totals.withdrawalsCompleted?.amount ?? 0)}</td>
                    <td className="px-4 py-3 text-ink-2">{run.accountsChecked}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[0.8rem] text-ink-3">
          The external side is not automated: compare the deposits figure with the payment
          provider&apos;s settled total for the same day. That comparison is the operator&apos;s step,
          not the job&apos;s.
        </p>
      </section>

      {breaks.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[1.05rem] font-medium tracking-tight text-red-700">
            Accounts whose ledger does not add up
          </h2>
          <p className="max-w-3xl text-[0.82rem] text-ink-2">
            The balance on the account row and the balance the ledger ends at disagree. Do not
            &ldquo;fix&rdquo; this by editing a balance: find the transaction that is wrong, and read{" "}
            <Link href="/admin/transactions" className="font-semibold underline underline-offset-2">
              the ledger
            </Link>{" "}
            for that account first.
          </p>
          <div className="overflow-x-auto rounded-2xl border border-red-200 bg-white">
            <table className="w-full min-w-[36rem] text-left text-[0.84rem]">
              <thead className="bg-red-50/60 text-meta uppercase tracking-wide text-red-700">
                <tr>
                  <th className="px-4 py-3 font-semibold">Account</th>
                  <th className="px-4 py-3 font-semibold">Wallet balance</th>
                  <th className="px-4 py-3 font-semibold">Ledger ends at</th>
                  <th className="px-4 py-3 font-semibold">Difference</th>
                </tr>
              </thead>
              <tbody>
                {breaks.map((row) => (
                  <tr key={row.user_id} className="border-t border-line/70">
                    <td className="px-4 py-3">{row.email}</td>
                    <td className="whitespace-nowrap px-4 py-3">{formatNaira(row.wallet_balance)}</td>
                    <td className="whitespace-nowrap px-4 py-3">{formatNaira(row.ledger_balance)}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-semibold text-red-700">
                      {formatNaira(row.wallet_balance - row.ledger_balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="rounded-xl border border-line bg-cream/60 px-4 py-3 text-[0.8rem] text-ink-2">
        There is no automatic resolver for any row on this page. Paystack settles top-ups through
        its webhook; transfers and supplier orders are completed by a person after checking the
        provider. Every action you take is recorded in{" "}
        <Link href="/admin/audit" className="font-semibold underline underline-offset-2">the audit log</Link>.
      </p>
    </div>
  );
}
