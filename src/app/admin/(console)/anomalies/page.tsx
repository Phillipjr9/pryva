import Link from "next/link";

import { listPayoutAnomalies } from "@/lib/admin/payout-anomalies";
import { requireAdmin } from "@/lib/identity/auth";

export const dynamic = "force-dynamic";

function formatNaira(amount: number) {
  return `₦${amount.toLocaleString("en-NG")}`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-NG", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AdminAnomaliesPage() {
  await requireAdmin("/admin/anomalies");
  const anomalies = await listPayoutAnomalies(25);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-line bg-white p-6 shadow-sm">
        <p className="text-micro font-semibold uppercase tracking-[0.14em] text-lav-700">Money risk</p>
        <h1 className="mt-3 text-2xl font-semibold text-ink">Payout anomaly queue</h1>
        <p className="mt-2 max-w-3xl text-sm text-ink-2">
          This is the exception queue for payout paths with elevated risk, stale pending requests, or unusual activity that deserves operator review before money leaves the platform.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <p className="text-sm text-ink-3">Visible anomalies</p>
          <p className="mt-3 text-3xl font-semibold text-ink">{anomalies.length}</p>
        </div>
        <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <p className="text-sm text-ink-3">High risk</p>
          <p className="mt-3 text-3xl font-semibold text-ink">{anomalies.filter((item) => item.riskLevel === "high").length}</p>
        </div>
        <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <p className="text-sm text-ink-3">Needs action</p>
          <p className="mt-3 text-3xl font-semibold text-ink">{anomalies.filter((item) => item.actionNeeded).length}</p>
        </div>
      </div>

      <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">Exception review</h2>
          <Link href="/admin/withdrawals" className="text-sm font-medium text-lav-700 hover:text-lav-800">
            Open payouts queue
          </Link>
        </div>

        {anomalies.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-cream/50 p-5 text-sm text-ink-2">
            No payout anomalies are currently waiting for review.
          </div>
        ) : (
          <div className="space-y-4">
            {anomalies.map((item) => (
              <article key={item.id} className="rounded-xl border border-line bg-[#fffdfa] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-ink">{item.reference}</p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[0.7rem] font-semibold ${
                          item.riskLevel === "high"
                            ? "bg-red-100 text-red-700"
                            : item.riskLevel === "warn"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {item.riskLevel}
                      </span>
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[0.7rem] font-semibold text-sky-700">
                        {item.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-ink-2">
                      {item.userEmail ?? "Customer account removed"} · {item.bankName} · {item.accountName}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="font-semibold text-ink">{formatNaira(item.amount + item.fee)}</p>
                    <p className="text-xs text-ink-3">{formatDate(item.createdAt)}</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg border border-line bg-white p-3">
                    <p className="text-[0.72rem] uppercase tracking-[0.12em] text-ink-3">Amount</p>
                    <p className="mt-1 font-medium text-ink">{formatNaira(item.amount)}</p>
                  </div>
                  <div className="rounded-lg border border-line bg-white p-3">
                    <p className="text-[0.72rem] uppercase tracking-[0.12em] text-ink-3">Fee</p>
                    <p className="mt-1 font-medium text-ink">{formatNaira(item.fee)}</p>
                  </div>
                  <div className="rounded-lg border border-line bg-white p-3">
                    <p className="text-[0.72rem] uppercase tracking-[0.12em] text-ink-3">Age</p>
                    <p className="mt-1 font-medium text-ink">{item.ageHours.toFixed(1)} hrs</p>
                  </div>
                </div>

                {item.riskReasons ? (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-amber-800">Risk reasons</p>
                    <p className="mt-1 text-sm text-amber-900">{item.riskReasons}</p>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
