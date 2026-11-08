import { formatUnitCount } from "@/lib/services/service-units";

/** Unknown is intentionally distinct from a confirmed zero. */
export function UnitsStatus({ stock = null, owned = null }: { stock?: number | null; owned?: number | null }) {
  return (
    <span className="grid grid-cols-1 gap-1 rounded-md bg-cream/70 p-1.5 text-left sm:grid-cols-2 sm:gap-1.5 sm:px-2.5 sm:py-2">
      <span className="rounded-sm bg-white/50 px-1.5 py-1">
        <span className="block text-[0.42rem] font-medium uppercase tracking-[0.14em] text-ink-3 sm:text-[0.48rem]">Stock</span>
        <span className="mt-0.5 block text-[0.58rem] font-medium leading-tight text-ink sm:text-[0.66rem]">{formatUnitCount(stock, "Unknown")}</span>
      </span>
      <span className="rounded-sm bg-white/50 px-1.5 py-1">
        <span className="block text-[0.42rem] font-medium uppercase tracking-[0.14em] text-ink-3 sm:text-[0.48rem]">My units</span>
        <span className="mt-0.5 block text-[0.58rem] font-medium leading-tight text-ink sm:text-[0.66rem]">{formatUnitCount(owned, "Not tracked")}</span>
      </span>
    </span>
  );
}
