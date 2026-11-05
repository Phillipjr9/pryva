import Link from "next/link";

import { requireAdmin } from "@/lib/auth";
import { buildStockReport } from "@/lib/stock-live";
import { laneHeadline, type StockLane, type StockState } from "@/lib/stock-report";

export const dynamic = "force-dynamic";

/**
 * What the live feeds have, right now.
 *
 * The shop knows what it advertises. It could not, before this page, say what the
 * feeds actually hold: numbers and rentals were sold from a fixed list with no
 * stock read, boosts had a per-order maximum but no availability view, and an
 * account marketplace feed that was connected but empty looked exactly like one
 * that was working.
 *
 * Every call behind this is a catalog list or a balance read. It cannot buy,
 * cancel or refund anything, so pressing refresh is always safe.
 */

const STATE_STYLES: Record<StockState, { chip: string; label: string }> = {
  "in-stock": { chip: "bg-emerald-50 text-emerald-700", label: "In stock" },
  low: { chip: "bg-amber-50 text-amber-800", label: "Low" },
  "out-of-stock": { chip: "bg-red-50 text-red-700", label: "Out of stock" },
  "no-match": { chip: "bg-red-50 text-red-700", label: "Not listed" },
  unknown: { chip: "bg-slate-100 text-ink-2", label: "Unknown" },
  unpriced: { chip: "bg-amber-50 text-amber-800", label: "No price" },
  "not-sold": { chip: "bg-slate-100 text-ink-2", label: "Not sold" },
};

/** Enough lines to act on, few enough that the page stays readable. */
const LINES_PER_LANE = 12;

function Lane({ lane }: { lane: StockLane }) {
  const shown = lane.lines.slice(0, LINES_PER_LANE);
  const hidden = lane.lines.length - shown.length;

  return (
    <section className="rounded-2xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[1.05rem] font-medium text-ink">{lane.label}</h2>
        <span
          className={`rounded-full px-2.5 py-0.5 text-meta font-semibold ${
            !lane.connected
              ? "bg-red-50 text-red-700"
              : lane.sellable > 0
                ? "bg-emerald-50 text-emerald-700"
                : "bg-slate-100 text-ink-2"
          }`}
        >
          {laneHeadline(lane)}
        </span>
      </div>

      {shown.length > 0 && (
        <ul className="mt-3 divide-y divide-line/60">
          {shown.map((line) => {
            const style = STATE_STYLES[line.state];
            return (
              <li key={`${lane.lane}-${line.id}`} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <div className="min-w-0">
                  <p className="truncate text-[0.88rem] font-medium text-ink">{line.label}</p>
                  <p className="text-[0.8rem] text-ink-2">{line.note}</p>
                </div>
                <div className="flex items-center gap-2">
                  {line.stock !== null && (
                    <span className="text-[0.84rem] font-semibold tabular-nums text-ink">{line.stock}</span>
                  )}
                  <span className={`rounded-full px-2 py-0.5 text-meta font-semibold ${style.chip}`}>
                    {style.label}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {hidden > 0 && <p className="mt-2 text-[0.8rem] text-ink-3">…and {hidden} more</p>}
      {lane.error && <p className="mt-2 text-[0.8rem] text-red-700">{lane.error}</p>}
    </section>
  );
}

export default async function AdminStockPage({
  searchParams,
}: {
  searchParams: Promise<{ refresh?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const report = await buildStockReport({ refresh: params.refresh === "1" });

  const buyable = report.lanes.reduce((total, lane) => total + lane.sellable, 0);
  const listed = report.lanes.reduce((total, lane) => total + lane.total, 0);
  const down = report.lanes.filter((lane) => !lane.connected);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.5rem] font-medium tracking-tight">Stock</h1>
          <p className="mt-1 max-w-2xl text-[0.86rem] text-ink-2">
            Read live from the feeds just now, not from the catalogue we advertise.{" "}
            <strong>In stock</strong> means a feed reported units, <strong>unknown</strong> means it
            listed the product without saying how many — not the same as zero — and{" "}
            <strong>not sold</strong> means the feed answers but nothing of ours is mapped to it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-xl border border-line bg-white px-4 py-2 text-right">
            <p className="text-meta uppercase tracking-wide text-ink-3">Buyable now</p>
            <p className="text-[1rem] font-semibold text-ink">
              {buyable} of {listed}
            </p>
          </div>
          <Link
            href="/admin/stock?refresh=1"
            className="rounded-xl border border-line bg-white px-4 py-2 text-[0.85rem] font-semibold text-ink hover:bg-cream"
          >
            Read the feeds again
          </Link>
        </div>
      </div>

      {down.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[0.86rem] text-red-800">
          <strong>{down.length} feed{down.length === 1 ? "" : "s"} did not answer:</strong>{" "}
          {down.map((lane) => lane.label).join(", ")}. Their lanes cannot sell until they do — check
          the credential and the feed itself, not the code.
        </div>
      )}

      <div className="space-y-3">
        {report.lanes.map((lane) => (
          <Lane key={lane.lane} lane={lane} />
        ))}
      </div>

      <section className="rounded-2xl border border-line bg-white p-4">
        <h2 className="text-[1.05rem] font-medium text-ink">What this page cannot tell you</h2>
        <p className="mt-1 max-w-3xl text-[0.86rem] text-ink-2">
          Stock is what a feed says about itself, and a feed can be wrong: it can list a number it
          cannot actually issue, or hold a balance too low to buy it. Only a real order settles that —
          <Link href="/admin/services" className="mx-1 underline">
            service coverage
          </Link>
          shows what happened to actual customers, and the two pages disagreeing is the useful signal.
          The same report is available as JSON at{" "}
          <code className="rounded bg-cream px-1 py-0.5 text-[0.8rem]">/api/diagnostics/stock</code>{" "}
          with the diagnostics secret, for anything that needs to watch it.
        </p>
        <p className="mt-2 text-[0.8rem] text-ink-3">
          Checked {new Date(report.checkedAt).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })} Lagos time.
        </p>
      </section>
    </div>
  );
}
