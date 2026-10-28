import { formatUnitCount } from "@/lib/service-units";

/** Unknown is intentionally distinct from a confirmed zero. */
export function UnitsStatus({ stock = null, owned = null, demo = false, loading = false }: { stock?: number | null; owned?: number | null; demo?: boolean; loading?: boolean }) {
  return (
    <span className="grid grid-cols-2 gap-2 rounded-xl bg-cream/80 px-3 py-2.5 text-left">
      <span className="block">
        <span className="block text-[0.59rem] font-medium uppercase tracking-[0.08em] text-ink-3">{demo ? "Demo stock" : "Stock"}</span>
        <span className="mt-0.5 block text-[0.72rem] font-semibold text-ink">{formatUnitCount(stock, demo ? (loading ? "Checking…" : "—") : "Unknown")}</span>
      </span>
      <span className="block">
        <span className="block text-[0.59rem] font-medium uppercase tracking-[0.08em] text-ink-3">{demo ? "My demo units" : "My units"}</span>
        <span className="mt-0.5 block text-[0.72rem] font-semibold text-ink">{formatUnitCount(owned, demo ? (loading ? "Checking…" : "—") : "Not tracked")}</span>
      </span>
    </span>
  );
}
