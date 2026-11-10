"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Item = { id: string; name: string; stock: "reported" | "out" | "unknown"; checkout?: "codes" | "topups" | "esims" };
type State = { kind: "loading" } | { kind: "error" } | { kind: "loaded"; items: Item[] };

/** Small read-only window onto the same catalogue as the full browser. */
export function DigitalCatalogHighlights() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/services/digital-catalog?stock=available", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok || !Array.isArray(data.items)) throw new Error("Unavailable");
        const items: Item[] = data.items.filter((item: unknown): item is Item => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return false;
          const value = item as Record<string, unknown>;
          return typeof value.id === "string" && /^digital-[a-f0-9]{24}$/.test(value.id) &&
            typeof value.name === "string" && value.name.length > 0 && value.stock === "reported";
        }).slice(0, 6);
        if (!controller.signal.aborted) setState({ kind: "loaded", items });
      })
      .catch(() => { if (!controller.signal.aborted) setState({ kind: "error" }); });
    return () => controller.abort();
  }, [revision]);

  return <section aria-labelledby="digital-highlights-title" className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="digital-highlights-title" className="text-[1rem] font-semibold text-ink">Digital products</h2><p className="mt-1 text-meta text-ink-2">Explore games, top-ups, subscriptions and more. Reported stock can change and does not guarantee checkout.</p></div>
      <Link href="/dashboard/digital-catalog" className="text-meta font-semibold text-lav-700 underline">Browse all digital products</Link>
    </div>
    {state.kind === "loading" && <p role="status" className="mt-4 text-meta text-ink-2">Loading digital products…</p>}
    {state.kind === "error" && <p role="alert" className="mt-4 text-meta text-rose-700">Could not load digital products. <button type="button" className="font-semibold underline" onClick={() => { setState({ kind: "loading" }); setRevision((value) => value + 1); }}>Retry</button></p>}
    {state.kind === "loaded" && (state.items.length ? <ul className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {state.items.map((item) => <li key={item.id} className="min-w-0 rounded-xl border border-line bg-white p-3"><p className="break-words text-[0.85rem] font-semibold text-ink">{item.name}</p><p className="mt-1 text-meta text-ink-3">Stock reported</p>{item.checkout && ["codes", "topups", "esims"].includes(item.checkout) ? <Link href={`/dashboard/digital-${item.checkout}?product=${encodeURIComponent(item.id)}`} className="mt-1 inline-block text-meta font-semibold text-lav-700 underline">Check price and availability</Link> : <p className="mt-1 text-meta text-ink-3">Not available to order</p>}</li>)}
    </ul> : <p className="mt-4 text-meta text-ink-2">No in-stock listings returned. Browse the catalogue for more options.</p>)}
  </section>;
}
