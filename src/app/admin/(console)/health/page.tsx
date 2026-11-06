import Link from "next/link";
import { requireAdmin } from "@/lib/identity/auth";
import { db } from "@/db";
import { orders, paymentTopups, withdrawals } from "@/db/schema";
import { asc, eq, inArray } from "drizzle-orm";
import { listFraudEvents } from "@/lib/admin/fraud";
import { ledgerBreaks, recentReconciliationRuns } from "@/lib/payments/daily-reconciliation";

export const dynamic = "force-dynamic";

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

const statusTone: Record<string, string> = {
  processing: "bg-amber-50 text-amber-700",
  review: "bg-rose-50 text-rose-700",
  pending: "bg-sky-50 text-sky-700",
  attention: "bg-red-50 text-red-700",
  clean: "bg-emerald-50 text-emerald-700",
};

const FRAUD_KIND_LABEL: Record<string, string> = {
  withdrawal_review: "Withdrawal flagged",
  withdrawal_velocity: "Withdrawal velocity",
  referral_same_network: "Referral from the same network",
  purchase_velocity: "Too many purchases",
  gift_card_velocity: "Too many gift cards",
};

export default async function AdminHealthPage() {
  await requireAdmin("/admin/health");

  const [recentRuns, ledgerIssues, outstandingOrders, outstandingWithdrawals, pendingTopups, openFraudSignals] = await Promise.all([
    recentReconciliationRuns(7),
    ledgerBreaks(8),
    db
      .select({
        id: orders.id,
        reference: orders.reference,
        productName: orders.productName,
        amount: orders.amount,
        status: orders.status,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(inArray(orders.status, ["processing", "review"]))
      .orderBy(asc(orders.createdAt))
      .limit(12),
    db
      .select({
        id: withdrawals.id,
        reference: withdrawals.reference,
        amount: withdrawals.amount,
        fee: withdrawals.fee,
        status: withdrawals.status,
        createdAt: withdrawals.createdAt,
      })
      .from(withdrawals)
      .where(inArray(withdrawals.status, ["pending", "processing"]))
      .orderBy(asc(withdrawals.createdAt))
      .limit(12),
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
      .limit(12),
    listFraudEvents({ openOnly: true, limit: 6 }),
  ]);

  const totalAttention = outstandingOrders.length + outstandingWithdrawals.length + pendingTopups.length + ledgerIssues.length + openFraudSignals.length;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-line bg-white p-6 shadow-sm">
        <p className="text-micro font-semibold uppercase tracking-[0.14em] text-lav-700">Operations health</p>
        <h1 className="mt-3 text-2xl font-semibold text-ink">Alert queue and operational watchlist</h1>
        <p className="mt-2 max-w-3xl text-sm text-ink-2">
          This is the short list for operator attention: unresolved money flows, pending provider checks, and any ledger drift that would make the books unreliable.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <p className="text-sm text-ink-3">Unresolved orders</p>
          <p className="mt-3 text-3xl font-semibold text-ink">{outstandingOrders.length}</p>
          <p className="mt-2 text-xs text-ink-3">Review or processing</p>
        </div>
        <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <p className="text-sm text-ink-3">Pending payouts</p>
          <p className="mt-3 text-3xl font-semibold text-ink">{outstandingWithdrawals.length}</p>
          <p className="mt-2 text-xs text-ink-3">Awaiting provider confirmation</p>
        </div>
        <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <p className="text-sm text-ink-3">Pending topups</p>
          <p className="mt-3 text-3xl font-semibold text-ink">{pendingTopups.length}</p>
          <p className="mt-2 text-xs text-ink-3">Awaiting payment completion</p>
        </div>
        <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <p className="text-sm text-ink-3">Ledger mismatches</p>
          <p className="mt-3 text-3xl font-semibold text-ink">{ledgerIssues.length}</p>
          <p className="mt-2 text-xs text-ink-3">Accounts needing reconciliation</p>
        </div>
        <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <p className="text-sm text-ink-3">Open fraud signals</p>
          <p className="mt-3 text-3xl font-semibold text-ink">{openFraudSignals.length}</p>
          <p className="mt-2 text-xs text-ink-3">Awaiting operator review</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">Current attention</h2>
              <p className="text-xs text-ink-3">The queue that deserves manual review today.</p>
            </div>
            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${totalAttention > 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
              {totalAttention > 0 ? `${totalAttention} items` : "All clear"}
            </span>
          </div>

          <div className="space-y-4">
            {outstandingOrders.length === 0 && outstandingWithdrawals.length === 0 && pendingTopups.length === 0 && ledgerIssues.length === 0 && openFraudSignals.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line bg-cream/40 p-5 text-sm text-ink-2">
                No operator attention is currently required.
              </div>
            ) : (
              <>
                {outstandingOrders.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink-3">Orders</p>
                    <div className="space-y-2">
                      {outstandingOrders.map((row) => (
                        <Link key={row.id} href="/admin/orders" className="flex items-center justify-between rounded-xl border border-line px-3 py-2 text-sm hover:bg-cream">
                          <div>
                            <div className="font-medium text-ink">{row.reference}</div>
                            <div className="text-ink-3">{row.productName} · {row.status}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold text-ink">{formatNaira(row.amount)}</div>
                            <div className="text-ink-3">{formatDate(row.createdAt)}</div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {outstandingWithdrawals.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink-3">Withdrawals</p>
                    <div className="space-y-2">
                      {outstandingWithdrawals.map((row) => (
                        <Link key={row.id} href="/admin/withdrawals" className="flex items-center justify-between rounded-xl border border-line px-3 py-2 text-sm hover:bg-cream">
                          <div>
                            <div className="font-medium text-ink">{row.reference}</div>
                            <div className="text-ink-3">{row.status}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold text-ink">{formatNaira(row.amount + row.fee)}</div>
                            <div className="text-ink-3">{formatDate(row.createdAt)}</div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {pendingTopups.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink-3">Pending topups</p>
                    <div className="space-y-2">
                      {pendingTopups.map((row) => (
                        <div key={row.reference} className="flex items-center justify-between rounded-xl border border-line px-3 py-2 text-sm">
                          <div>
                            <div className="font-medium text-ink">{row.reference}</div>
                            <div className="text-ink-3">{row.status}</div>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold text-ink">{formatNaira(row.amount)}</div>
                            <div className="text-ink-3">{formatDate(row.createdAt)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {openFraudSignals.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink-3">Fraud signals</p>
                    <div className="space-y-2">
                      {openFraudSignals.map((row) => (
                        <div key={row.id} className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium text-red-900">{FRAUD_KIND_LABEL[row.kind] ?? row.kind}</div>
                            <span className={`rounded-full px-2 py-0.5 text-[0.7rem] font-semibold ${row.severity === "high" ? "bg-red-100 text-red-700" : row.severity === "warn" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700"}`}>
                              {row.severity}
                            </span>
                          </div>
                          <div className="mt-1 text-red-800">{row.reasons}</div>
                          {row.amount ? <div className="mt-1 text-red-700">{formatNaira(row.amount)}</div> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {ledgerIssues.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink-3">Ledger drift</p>
                    <div className="space-y-2">
                      {ledgerIssues.map((row) => (
                        <div key={row.user_id} className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium text-red-900">{row.email}</div>
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[0.7rem] font-semibold text-red-700">Mismatch</span>
                          </div>
                          <div className="mt-1 text-red-800">Wallet {formatNaira(row.wallet_balance)} · ledger {formatNaira(row.ledger_balance)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-ink">Recent reconciliation</h2>
          <p className="mt-1 text-xs text-ink-3">Operation outcome for the most recent close windows.</p>

          <div className="mt-4 space-y-3">
            {recentRuns.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line bg-cream/40 p-4 text-sm text-ink-2">
                No reconciliation runs have been recorded yet.
              </div>
            ) : (
              recentRuns.map((run) => (
                <div key={run.day} className="rounded-xl border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-medium text-ink">{run.day}</div>
                      <div className="text-xs text-ink-3">{run.accountsChecked} accounts checked</div>
                    </div>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[0.7rem] font-semibold ${statusTone[run.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {run.status}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-ink-2">
                    {run.discrepancies} discrepancy{run.discrepancies === 1 ? "" : "ies"} · {run.notes ?? "No detailed note available"}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-5 rounded-xl border border-line bg-cream/40 p-3 text-xs text-ink-2">
            <strong className="text-ink">Operator drilldown:</strong> use the daily close to check provider-side totals, then open the reconciliation queue for anything that remains unresolved.
          </div>
        </section>
      </div>
    </div>
  );
}
