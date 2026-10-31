import Link from "next/link";
import { and, count, inArray, lt, sql } from "drizzle-orm";

import { requireAdmin } from "@/lib/auth";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { isFleexaConfigured } from "@/lib/fleexa";
import { isSmmPanelConfigured } from "@/lib/smm-panel";
import { isMarketplaceCheckoutConfigured } from "@/lib/marketplace-policy";
import { isManualFulfilmentReachable } from "@/lib/manual-fulfilment";
import { isPreviewDatabase } from "@/lib/demo-policy";
import {
  NOT_FOR_SALE,
  SERVICE_LANES,
  countingSummary,
  summariseLane,
  type LaneId,
  type LaneHealth,
  type OrderTally,
} from "@/lib/service-coverage";

export const dynamic = "force-dynamic";

/**
 * Is anything actually being delivered?
 *
 * The question behind "are the suppliers working?" cannot be answered by a key
 * being present: a configured supplier that has never fulfilled an order is not
 * working, it is untested. This page answers from evidence — the orders table —
 * and states plainly which lanes are selling, which have never sold, and which
 * are refusing to accept money because nothing can deliver them.
 *
 * It does not call any supplier. A live call would tell you what the supplier
 * says about itself; this page tells you what happened to customers.
 */

function configuredFor(id: LaneId): boolean {
  switch (id) {
    // The one that is not an env var: purchases are refused outright on the
    // preview database, so the lane is genuinely closed there.
    case "scheduled":
      return isPreviewDatabase();
    case "numbers":
      return isFleexaConfigured();
    case "boosts":
      return isSmmPanelConfigured();
    case "accounts":
      return isMarketplaceCheckoutConfigured();
    default:
      return false;
  }
}

const VERDICT_STYLES: Record<LaneHealth["verdict"], { chip: string; label: string }> = {
  delivering: { chip: "bg-emerald-50 text-emerald-700", label: "Delivering" },
  untested: { chip: "bg-amber-50 text-amber-800", label: "Untested" },
  "needs-attention": { chip: "bg-red-50 text-red-700", label: "Needs attention" },
  unavailable: { chip: "bg-slate-100 text-ink-2", label: "Not for sale" },
};

function countLabel(value: number | string | null): string {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric.toLocaleString("en-NG") : "0";
}

export default async function AdminServicesPage() {
  await requireAdmin("/admin/services");

  const now = new Date();

  // One grouped read for the whole table: provider × status, with how many of
  // those rows already carry a reference code and when the newest one landed.
  const tallyRows = await db
    .select({
      provider: orders.provider,
      status: orders.status,
      total: count(),
      withCode: sql<number>`count(${orders.referenceCode})`,
      latest: sql<Date>`max(${orders.createdAt})`,
    })
    .from(orders)
    .groupBy(orders.provider, orders.status);

  const tallies: OrderTally[] = tallyRows.map((row) => ({
    provider: row.provider,
    status: row.status,
    total: Number(row.total),
    withCode: Number(row.withCode ?? 0),
    latest: row.latest,
  }));

  const open = ["processing", "active", "review"];
  const staleByLane = new Map<LaneId, number>();
  await Promise.all(
    SERVICE_LANES.filter((lane) => lane.providers.length > 0 && lane.staleHours > 0).map(async (lane) => {
      const cutoff = new Date(now.getTime() - lane.staleHours * 3_600_000);
      const [row] = await db
        .select({ total: count() })
        .from(orders)
        .where(
          and(
            inArray(orders.provider, lane.providers),
            inArray(orders.status, open),
            lt(orders.createdAt, cutoff),
          ),
        );
      staleByLane.set(lane.id, Number(row?.total ?? 0));
    }),
  );

  const lanes = SERVICE_LANES.map((spec) =>
    summariseLane({
      spec,
      tallies,
      stale: staleByLane.get(spec.id) ?? 0,
      configured: configuredFor(spec.id),
      now,
    }),
  );

  const summary = countingSummary(lanes);
  const manualReachable = await isManualFulfilmentReachable();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.5rem] font-medium tracking-tight">Service coverage</h1>
          <p className="mt-1 max-w-2xl text-[0.86rem] text-ink-2">
            Every lane is judged by what happened to customers, not by whether a key is set. A lane
            is <strong>delivering</strong> when an order reached someone in the last 7 days,
            <strong> untested</strong> when it has never sold anything, and
            <strong> not for sale</strong> when the gates refuse to take money for it.
          </p>
        </div>
        <div className="rounded-xl border border-line bg-white px-4 py-2 text-right">
          <p className="text-meta uppercase tracking-wide text-ink-3">Lanes delivering</p>
          <p className="text-[1rem] font-semibold text-ink">
            {summary.healthy} of {summary.total}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {lanes.map((lane) => {
          const style = VERDICT_STYLES[lane.verdict];
          return (
            <section key={lane.id} className="rounded-2xl border border-line bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[1.05rem] font-medium text-ink">{lane.label}</h2>
                <span className={`rounded-full px-2.5 py-0.5 text-meta font-semibold ${style.chip}`}>
                  {style.label}
                </span>
              </div>
              <p className="mt-1 text-[0.86rem] text-ink-2">{lane.headline}</p>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[0.82rem] sm:grid-cols-6">
                <div>
                  <dt className="text-meta uppercase tracking-wide text-ink-3">Orders</dt>
                  <dd className="font-semibold text-ink">{countLabel(lane.orders)}</dd>
                </div>
                <div>
                  <dt className="text-meta uppercase tracking-wide text-ink-3">Delivered</dt>
                  <dd className="font-semibold text-ink">{countLabel(lane.delivered)}</dd>
                </div>
                <div>
                  <dt className="text-meta uppercase tracking-wide text-ink-3">Issued</dt>
                  <dd className="font-semibold text-ink">{countLabel(lane.issued)}</dd>
                </div>
                <div>
                  <dt className="text-meta uppercase tracking-wide text-ink-3">In flight</dt>
                  <dd className="font-semibold text-ink">{countLabel(lane.running)}</dd>
                </div>
                <div>
                  <dt className="text-meta uppercase tracking-wide text-ink-3">Refunded / review</dt>
                  <dd className="font-semibold text-ink">{countLabel(lane.failed)}</dd>
                </div>
                <div>
                  <dt className="text-meta uppercase tracking-wide text-ink-3">Stuck</dt>
                  <dd className={`font-semibold ${lane.stale > 0 ? "text-red-700" : "text-ink"}`}>
                    {countLabel(lane.stale)}
                  </dd>
                </div>
              </dl>

              <div className="mt-3 grid gap-2 text-[0.82rem] text-ink-2 sm:grid-cols-2">
                <p>
                  <span className="font-medium text-ink">Delivery: </span>
                  {lane.delivery}
                </p>
                <p>
                  <span className="font-medium text-ink">If it fails: </span>
                  {lane.recovery}
                </p>
              </div>
            </section>
          );
        })}
      </div>

      <section className="rounded-2xl border border-line bg-white p-4">
        <h2 className="text-[1.05rem] font-medium text-ink">Not for sale, on purpose</h2>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          These appear in the catalogue as information. There is no purchase path, so nobody can pay
          for one.
        </p>
        <ul className="mt-3 space-y-1.5 text-[0.84rem] text-ink-2">
          {NOT_FOR_SALE.map((entry) => (
            <li key={entry.label}>
              <span className="font-medium text-ink">{entry.label}</span> — {entry.reason}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-line bg-white p-4">
        <h2 className="text-[1.05rem] font-medium text-ink">What this page cannot tell you</h2>
        <p className="mt-1 max-w-3xl text-[0.86rem] text-ink-2">
          It reads the order history, so a supplier that is down right now still reads
          <em> delivering</em> until a purchase fails. To ask a supplier about itself, use
          <Link href="/admin/boosting" className="mx-1 underline">
            Boosting → Run live check
          </Link>
          for the boosting panel, and <code className="font-mono text-micro">/api/diagnostics/integrations</code>{" "}
          (bearer <code className="font-mono text-micro">DIAGNOSTICS_SECRET</code>) for balance and
          catalog probes on the rest.
        </p>
        <p className="mt-2 text-[0.84rem] text-ink-2">
          Gift cards are not a lane here: they are Pryva-issued wallet credit, and the code comes back
          from the purchase call itself — there is no supplier to be late. A row of them lives in
          <Link href="/admin/transactions" className="mx-1 underline">
            the ledger
          </Link>
          , not in the orders table.
        </p>
        <p className="mt-2 text-[0.84rem] text-ink-2">
          Hand-prepared fulfilment is{" "}
          <span className="font-semibold text-ink">{manualReachable ? "reachable" : "unreachable"}</span>
          {manualReachable
            ? " — a verified administrator exists, so that queue can be worked."
            : " — no verified administrator exists, which is why those listings refuse payment."}
        </p>
      </section>
    </div>
  );
}
