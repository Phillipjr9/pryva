import { count, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAdmin } from "@/lib/identity/auth";
import { RETENTION_YEARS, countDueForPurge, purgeEnabled, retentionCutoff } from "@/lib/identity/retention";

export const dynamic = "force-dynamic";

function formatDate(value: Date) {
  return value.toLocaleString("en-NG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AdminRetentionPage() {
  await requireAdmin("/admin/retention");

  const [closedRow] = await db.select({ total: count() }).from(users).where(isNotNull(users.deletedAt));
  const due = await countDueForPurge();
  const armed = purgeEnabled();
  const cutoff = retentionCutoff();

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-line bg-white p-6 shadow-sm">
        <p className="text-micro font-semibold uppercase tracking-[0.14em] text-lav-700">Compliance</p>
        <h1 className="mt-3 text-2xl font-semibold text-ink">Retention and deletion controls</h1>
        <p className="mt-2 max-w-3xl text-sm text-ink-2">
          This is the legal and operational review for closed accounts. The system keeps the data for the retention horizon, and the destructive sweep is still disarmed unless the deployment explicitly turns it on.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <p className="text-sm text-ink-3">Retention period</p>
          <p className="mt-3 text-3xl font-semibold text-ink">{RETENTION_YEARS}y</p>
          <p className="mt-2 text-xs text-ink-3">Financial record horizon</p>
        </div>
        <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <p className="text-sm text-ink-3">Closed accounts</p>
          <p className="mt-3 text-3xl font-semibold text-ink">{Number(closedRow?.total ?? 0)}</p>
          <p className="mt-2 text-xs text-ink-3">Accounts with a deletion record</p>
        </div>
        <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <p className="text-sm text-ink-3">Due for purge</p>
          <p className="mt-3 text-3xl font-semibold text-ink">{due}</p>
          <p className="mt-2 text-xs text-ink-3">Past the retention cutoff</p>
        </div>
        <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <p className="text-sm text-ink-3">Sweep status</p>
          <p className={`mt-3 text-2xl font-semibold ${armed ? "text-emerald-700" : "text-amber-700"}`}>
            {armed ? "Armed" : "Disarmed"}
          </p>
          <p className="mt-2 text-xs text-ink-3">{armed ? "The nightly sweep is active" : "No deletion is happening"}</p>
        </div>
      </div>

      <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-ink">Current retention window</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-line bg-cream/50 p-4">
            <p className="text-[0.72rem] uppercase tracking-[0.12em] text-ink-3">Cutoff date</p>
            <p className="mt-2 text-lg font-semibold text-ink">{formatDate(cutoff)}</p>
          </div>
          <div className="rounded-xl border border-line bg-cream/50 p-4">
            <p className="text-[0.72rem] uppercase tracking-[0.12em] text-ink-3">Status</p>
            <p className={`mt-2 text-lg font-semibold ${due > 0 ? "text-red-700" : "text-emerald-700"}`}>
              {due > 0 ? `${due} closure(s) need review` : "No closure is currently due"}
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Operational rule</p>
          <p className="mt-1 leading-relaxed">
            A closed account is only eligible for purge after the retention window. The system still keeps a record of any active payout or unresolved claim, so the sweep stops before it erases a live money trail.
          </p>
        </div>
      </section>
    </div>
  );
}
