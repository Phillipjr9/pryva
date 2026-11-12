"use client";

import { useEffect, useState } from "react";
import { fetchCatalogue } from "@/lib/platform/catalog-fetch";
import { BrandIcon } from "@/components/BrandIcon";
import type { PublicUser } from "@/lib/identity/auth";
import type { ClubkonnectPlan } from "@/lib/providers/clubkonnect";

interface DataPlansFormProps { user?: PublicUser; initialPlanId?: string }
type Catalogue = { plans: ClubkonnectPlan[]; checkedAt: string; stale: boolean; checkoutReason: string };
const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" });

function NetworkMark({ code, name }: { code: string; name: string }) {
  const brand = ({ "01": "mtn", "02": "glo", "04": "airtel" } as const)[code as "01" | "02" | "04"];
  if (brand) return <BrandIcon brand={brand} decorative size={40} />;
  // Do not apply a legacy 9mobile logo to a renamed carrier or invent a mark.
  return <span aria-hidden="true" className="grid h-10 min-w-10 place-items-center rounded-lg border border-line px-2 text-meta font-semibold">{name}</span>;
}

export function DataPlansForm({ initialPlanId }: DataPlansFormProps) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [network, setNetwork] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetchCatalogue("/api/airtime/plans", controller.signal)
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load data plans.");
        if (!Array.isArray(body.plans)) throw new Error("Invalid catalogue response.");
        if (!controller.signal.aborted) setCatalogue(body);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load data plans.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  const plans = catalogue?.plans ?? [];
  const networks = [...new Map(plans.map(plan => [plan.networkCode, plan.network])).entries()];
  const visible = plans.filter(plan => (!network || plan.networkCode === network) &&
    `${plan.network} ${plan.name} ${plan.dataType ?? ""}`.toLowerCase().includes(search.toLowerCase().trim()))
    .sort((a, b) => a.publishedAmountKobo - b.publishedAmountKobo);
  return <section className="space-y-4" aria-label="Live mobile data catalogue">
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-meta">Network<select className="mt-1 block rounded-lg border border-line bg-white p-3" value={network} onChange={event => setNetwork(event.target.value)}><option value="">All networks</option>{networks.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
      <label className="text-meta">Search bundles<input className="mt-1 block rounded-lg border border-line bg-white p-3" value={search} onChange={event => setSearch(event.target.value)} placeholder="e.g. 1GB or monthly" /></label>
      <button className="rounded-lg border border-line p-3 text-meta font-semibold" disabled={loading} onClick={() => { setLoading(true); setError(""); setReload(value => value + 1); }}>Reload listings</button>
    </div>
    {loading && <p role="status">Loading current bundles…</p>}
    {error && <p role="alert">{error} {catalogue ? "Previously loaded listings remain below." : "Use Reload listings to retry."}</p>}
    {catalogue && <>
      <p className="text-meta text-ink-2">Catalogue snapshot: <time dateTime={catalogue.checkedAt}>{new Date(catalogue.checkedAt).toLocaleString()}</time>. {catalogue.stale ? "Refresh delayed; these listings may have changed." : ""}</p>
      <p className="rounded-xl border border-line bg-white p-4 text-meta">Prices below are published catalogue prices, not checkout quotes. Numeric stock is not reported. {catalogue.checkoutReason}</p>
      {initialPlanId && <p className="text-meta">Choose a current bundle below; old plan links do not select a different product automatically.</p>}
      <p role="status" className="text-meta">{visible.length} bundles · lowest price first</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{visible.map(plan => <article key={plan.id} className="rounded-xl border border-line bg-white p-4">
        <div className="flex items-center gap-3"><NetworkMark code={plan.networkCode} name={plan.network} /><span className="text-meta font-semibold">{plan.network}</span></div>
        <h2 className="mt-3 text-[0.9375rem] font-semibold">{plan.name}</h2>
        <p className="mt-2 font-semibold">{money.format(plan.publishedAmountKobo / 100)}</p>
        {plan.dataType && <p className="mt-1 text-meta">{plan.dataType}</p>}
        <p className="mt-2 text-meta text-ink-2">Currently listed · stock count unavailable</p>
      </article>)}</div>
      {!visible.length && <p>No matching bundles. Try another network or search.</p>}
    </>}
  </section>;
}
