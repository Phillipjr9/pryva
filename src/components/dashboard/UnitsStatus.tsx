import { formatUnitCount } from "@/lib/service-units";

/** Unknown is intentionally distinct from a confirmed zero. */
export function UnitsStatus({ stock = null, owned = null }: { stock?: number | null; owned?: number | null }) {
  return (
    <span className="grid grid-cols-2 gap-2 rounded-xl bg-cream/80 px-3 py-2.5 text-left">
      <span className="block">
        <span className="block text-micro font-medium uppercase tracking-[0.08em] text-ink-3">Stock</span>
        <span className="mt-0.5 block text-meta font-semibold text-ink">{formatUnitCount(stock, "Unknown")}</span>
      </span>
      <span className="block">
        <span className="block text-micro font-medium uppercase tracking-[0.08em] text-ink-3">My units</span>
        <span className="mt-0.5 block text-meta font-semibold text-ink">{formatUnitCount(owned, "Not tracked")}</span>
      </span>
    </span>
  );
}
