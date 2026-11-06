import type { RevenuePoint } from "@/lib/admin/dashboard";
import { formatCurrency } from "@/lib/platform/utils";
import { adminDate } from "@/components/admin/AdminUi";

function ceiling(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const fraction = value / magnitude;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude;
}
function compact(value: number) {
  if (value >= 1_000_000) return `₦${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}m`;
  if (value >= 1_000) return `₦${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}k`;
  return `₦${value.toLocaleString("en-NG")}`;
}

/** Server-rendered, accessible reporting chart. Every bar comes from the ledger's orders. */
export function RevenueChart({ data }: { data: RevenuePoint[] }) {
  const hasRevenue = data.some((point) => point.revenue > 0);
  const max = ceiling(Math.max(0, ...data.map((point) => point.revenue)));
  const width = 720;
  const height = 252;
  const left = 57;
  const right = 12;
  const top = 18;
  const bottom = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const step = plotWidth / Math.max(data.length, 1);
  const barWidth = Math.max(2, Math.min(34, step * 0.62));
  const labelIndexes = new Set(Array.from({ length: Math.min(6, data.length) }, (_, index) => Math.round(index * (data.length - 1) / Math.max(1, Math.min(6, data.length) - 1))));

  return <>
    <div className="position-relative">
      <svg className="revenue-chart" viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Daily revenue from delivered orders, in Nigerian naira">
        {[0, 1, 2, 3, 4].map((tick) => {
          const y = top + plotHeight - (tick / 4) * plotHeight;
          return <g key={tick}><line className="chart-grid-line" x1={left} x2={width - right} y1={y} y2={y} />{hasRevenue && <text x={left - 10} y={y + 3} textAnchor="end">{compact(max * tick / 4)}</text>}</g>;
        })}
        {data.map((point, index) => {
          const barHeight = hasRevenue ? (point.revenue / max) * plotHeight : 0;
          const x = left + index * step + (step - barWidth) / 2;
          return <g key={point.day}>
            <rect className="chart-bar" x={x} y={top + plotHeight - barHeight} width={barWidth} height={barHeight} rx={Math.min(3, barWidth / 3)} tabIndex={0} role="img" aria-label={`${adminDate(point.day)}: ${formatCurrency(point.revenue)}, ${point.orders} delivered orders`} data-value={point.revenue} />
            {labelIndexes.has(index) && <text x={left + index * step + step / 2} y={height - 10} textAnchor="middle">{new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(point.day))}</text>}
          </g>;
        })}
      </svg>
      {!hasRevenue && <div className="chart-empty"><strong>No delivered revenue in this period</strong><span>Completed sales will appear here. No sample data is shown.</span></div>}
    </div>
    <details className="chart-data"><summary>View daily totals</summary><div className="table-wrap overflow-x-auto"><table><caption>Daily delivered-order revenue · UTC</caption><thead><tr><th scope="col">Day</th><th scope="col">Revenue</th><th scope="col">Delivered orders</th></tr></thead><tbody>{data.map((point) => <tr key={point.day}><td>{adminDate(point.day)}</td><td>{formatCurrency(point.revenue)}</td><td>{point.orders}</td></tr>)}</tbody></table></div></details>
  </>;
}
