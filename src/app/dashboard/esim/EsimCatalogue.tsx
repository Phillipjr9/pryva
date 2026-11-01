"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatNaira } from "@/lib/catalog";
import type { EsimCatalogueItem } from "@/lib/esim-catalog";

const PAGE = 24;

/**
 * The catalogue, as a list rather than a destination lookup.
 *
 * Sorted by price and paged in bundles of 24 with an explicit count, because the
 * failure this page exists to fix was "I cannot tell whether this list is short or
 * whether it is all there is". The number at the top is the whole catalogue; the
 * number under the filters is what the current filter matches.
 */
export function EsimCatalogue({ items, truncated }: { items: EsimCatalogueItem[]; truncated: boolean }) {
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState<string>("all");
  const [visible, setVisible] = useState(PAGE);

  const regions = useMemo(() => {
    const seen = new Map<string, number>();
    for (const item of items) seen.set(item.region, (seen.get(item.region) ?? 0) + 1);
    return [...seen.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [items]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter((item) => {
      if (region !== "all" && item.region !== region) return false;
      if (!needle) return true;
      return `${item.name} ${item.region} ${item.dataLabel} ${item.validityLabel}`.toLowerCase().includes(needle);
    });
  }, [items, region, search]);

  const shown = filtered.slice(0, visible);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="block">
          <span className="sr-only">Search eSIM plans</span>
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setVisible(PAGE);
            }}
            placeholder="Search a country, region or data allowance"
            className="min-h-11 w-full rounded-xl border border-line bg-white px-3 py-2 text-[0.86rem] text-ink outline-none placeholder:text-ink-3 focus:border-lav-400 focus:ring-4 focus:ring-lav-100"
          />
        </label>
        <label className="block">
          <span className="sr-only">Filter by region</span>
          <select
            value={region}
            onChange={(event) => {
              setRegion(event.target.value);
              setVisible(PAGE);
            }}
            className="min-h-11 w-full rounded-xl border border-line bg-white px-3 py-2 text-[0.86rem] text-ink sm:w-auto"
          >
            <option value="all">All regions ({items.length})</option>
            {regions.map(([name, count]) => (
              <option key={name} value={name}>
                {name} ({count})
              </option>
            ))}
          </select>
        </label>
      </div>

      <p aria-live="polite" className="text-meta text-ink-3">
        {filtered.length} {filtered.length === 1 ? "plan" : "plans"} match
        {region === "all" && !search.trim() ? "" : " this filter"}
        {truncated ? " · the cheapest plans are listed first" : ""}
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-cream/50 p-8 text-center">
          <p className="text-[0.9rem] font-semibold text-ink">No plan matches that</p>
          <p className="mt-1 text-meta text-ink-2">
            Try a country name, a region, or clear the filters — this does not mean the destination is unsupported.
          </p>
          {(search || region !== "all") && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setRegion("all");
                setVisible(PAGE);
              }}
              className="mt-3 text-meta font-semibold text-lav-700 underline underline-offset-2"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((item) => (
            <li key={item.id} className="flex flex-col justify-between rounded-xl border border-line bg-white p-4">
              <div>
                <p className="text-micro font-semibold uppercase tracking-[0.12em] text-lav-700">{item.region}</p>
                <p className="mt-1 text-[0.9rem] font-semibold text-ink">{item.name}</p>
                <p className="mt-1 text-meta text-ink-2">
                  {item.dataLabel} · {item.validityLabel} ·{" "}
                  {item.global ? "works in most countries" : `${item.destinations} destination${item.destinations === 1 ? "" : "s"}`}
                </p>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-[1rem] font-semibold tabular-nums text-ink">{formatNaira(item.priceNgn)}</p>
                {item.purchasable ? (
                  <Link
                    href={`/dashboard/esim/${encodeURIComponent(item.id)}`}
                    className="rounded-lg bg-lav-600 px-3 py-2 text-meta font-semibold text-white hover:bg-lav-700"
                  >
                    Buy eSIM
                  </Link>
                ) : (
                  <span className="text-right text-micro font-semibold leading-snug text-ink-3">
                    Not sellable at this price
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {visible < filtered.length && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => setVisible((current) => current + PAGE)}
            className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2.5 text-meta font-semibold text-ink-2 hover:border-lav-300 hover:text-lav-700"
          >
            Show more <span className="text-ink-3">({filtered.length - visible} remaining)</span>
          </button>
        </div>
      )}
    </div>
  );
}
