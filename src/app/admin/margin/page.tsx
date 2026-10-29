import { requireAdmin } from "@/lib/auth";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { configuredFloor } from "@/lib/margin-guard";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Realised margin per product.
 *
 * Selling prices are a markup on planned wholesale costs, so the honest question
 * is not "what margin did we set" but "what margin did we actually make". Each
 * order records what its unit really cost, and this page aggregates that.
 *
 * Refunded orders are treated asymmetrically on purpose: their revenue is
 * excluded but their cost is kept, because we really did buy that unit and then
 * gave the money back. Counting a refund as cost-free would flatter every plan
 * that fails often -- exactly the plans most worth noticing.
 *
 * Admin-only. Wholesale cost must never reach a customer-facing surface.
 */

/** Bounded so a large order history cannot make this page unrenderable. */
const WINDOW = 2000;

type Row = {
  slug: string;
  name: string;
  units: number;
  revenue: number;
  cost: number;
  refunds: number;
  unknownCost: number;
};

function naira(value: number): string {
  return `₦${Math.round(value).toLocaleString("en-NG")}`;
}

export default async function AdminMarginPage() {
  await requireAdmin();

  const recent = await db
    .select({
      slug: orders.productSlug,
      name: orders.productName,
      amount: orders.amount,
      cost: orders.providerCostNgn,
      status: orders.status,
    })
    .from(orders)
    .orderBy(desc(orders.createdAt))
    .limit(WINDOW);

  const bySlug = new Map<string, Row>();
  for (const order of recent) {
    const slug = order.slug ?? "unknown";
    const row = bySlug.get(slug) ?? {
      slug,
      name: order.name ?? slug,
      units: 0,
      revenue: 0,
      cost: 0,
      refunds: 0,
      unknownCost: 0,
    };
    if (order.status === "refunded") row.refunds += 1;
    if (typeof order.cost === "number") {
      row.units += 1;
      row.cost += order.cost;
      if (order.status !== "refunded") row.revenue += order.amount;
    } else {
      row.unknownCost += 1;
    }
    bySlug.set(slug, row);
  }

  const floor = configuredFloor();
  const rows = [...bySlug.values()]
    .map((row) => {
      const margin = row.revenue - row.cost;
      const ratio = row.revenue > 0 ? margin / row.revenue : null;
      return { ...row, margin, ratio };
    })
    .sort((a, b) => (a.ratio ?? 0) - (b.ratio ?? 0));

  const measurable = rows.filter((row) => row.units > 0);
  const unmeasurable = rows.filter((row) => row.units === 0);
  const totals = measurable.reduce(
    (acc, row) => ({
      revenue: acc.revenue + row.revenue,
      cost: acc.cost + row.cost,
      units: acc.units + row.units,
    }),
    { revenue: 0, cost: 0, units: 0 },
  );
  const totalRatio = totals.revenue > 0 ? (totals.revenue - totals.cost) / totals.revenue : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Realised margin</h1>
        <p className="mt-1 text-sm text-ink-2">
          What each product actually earned, from the cost recorded at purchase. The floor every
          sale must clear is {(floor * 100).toFixed(0)}%.
        </p>
      </div>

      {measurable.length === 0 ? (
        <div className="rounded-xl border border-line bg-white/70 p-5 text-sm text-ink-2">
          <p className="font-semibold text-ink">No measured margin yet.</p>
          <p className="mt-1.5 leading-relaxed">
            Cost is recorded when a purchase completes against a live provider. Until orders carry a
            recorded cost there is nothing to measure — planned prices from the cost sheet are not a
            substitute, which is the point of this page.
            {recent.length > 0
              ? ` ${recent.length} recent order(s) have no recorded cost.`
              : " No orders yet."}
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: "Units measured", value: totals.units.toLocaleString("en-NG") },
              { label: "Revenue", value: naira(totals.revenue) },
              {
                label: "Blended margin",
                value: totalRatio === null ? "—" : `${(totalRatio * 100).toFixed(1)}%`,
              },
            ].map((tile) => (
              <div key={tile.label} className="rounded-xl border border-line bg-white/70 p-4">
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-ink-3">
                  {tile.label}
                </p>
                <p className="mt-1 text-lg font-semibold text-ink">{tile.value}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-line bg-white/70">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[0.7rem] uppercase tracking-[0.12em] text-ink-3">
                  <th className="px-3 py-2.5 font-semibold">Product</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Units</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Revenue</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Cost</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Margin</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Refunds</th>
                </tr>
              </thead>
              <tbody>
                {measurable.map((row) => {
                  const below = row.ratio !== null && row.ratio < floor;
                  return (
                    <tr key={row.slug} className="border-b border-line/60 last:border-0">
                      <td className="px-3 py-2.5">
                        <span className="font-medium text-ink">{row.name}</span>
                        <span className="ml-2 text-[0.72rem] text-ink-3">{row.slug}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{row.units}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">
                        {naira(row.revenue)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">
                        {naira(row.cost)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[0.72rem] font-semibold tabular-nums ${
                            below ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                          }`}
                        >
                          {row.ratio === null ? "—" : `${(row.ratio * 100).toFixed(1)}%`}
                        </span>
                        {below && <span className="ml-1.5 text-[0.7rem] text-red-600">below floor</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-2">{row.refunds}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {unmeasurable.length > 0 && (
            <p className="text-[0.78rem] text-ink-3">
              {unmeasurable.length} product(s) have orders but no recorded cost yet:{" "}
              {unmeasurable.map((row) => row.slug).join(", ")}.
            </p>
          )}
          <p className="text-[0.78rem] text-ink-3">
            Aggregated from the {recent.length} most recent orders. Refunds count their cost but not
            their revenue.
          </p>
        </>
      )}
    </div>
  );
}
