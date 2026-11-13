"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { catalogueFailureReason, fetchCatalogue, SHARED_CATALOGUE_TIMEOUT_MS, type CatalogueFailureReason } from "@/lib/platform/catalog-fetch";
import { retryAfterDeadline } from "@/lib/platform/retry-after";
import { useRetryCooldown } from "@/lib/platform/use-retry-cooldown";
import { QuickShortcuts } from "@/components/QuickShortcuts";
import type { PublicUser } from "@/lib/identity/auth";
import type { ClubkonnectPlan } from "@/lib/providers/clubkonnect";

interface DataPlansFormProps { user?: PublicUser; initialPlanId?: string }
type DisplayPlan = Pick<ClubkonnectPlan, "id" | "network" | "networkCode" | "name" | "publishedAmountKobo" | "dataType">;
type Catalogue = {
  plans: DisplayPlan[];
  checkedAt: string | null;
  stale: boolean;
  checkoutReason: string;
  /** Something was missing from this read — malformed rows here, or on the server. */
  incomplete: boolean;
  /** Networks that were published with no readable bundle at all. */
  emptyNetworks: string[];
};
const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" });

/** "a", "a and b", "a, b and c" — a list a customer can read out loud. */
function listNames(names: string[]): string {
  const unique = [...new Set(names)];
  return unique.length <= 1 ? unique.join("") : `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

/** A malformed row must not take down the page or hide other usable bundles. */
function readCatalogue(value: unknown): Catalogue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.plans)) return null;
  const plans: DisplayPlan[] = [];
  const seen = new Set<string>();
  const emptyNetworks: string[] = [];
  let incomplete = false;
  for (const raw of body.plans) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { incomplete = true; continue; }
    const plan = raw as Record<string, unknown>;
    if (typeof plan.id !== "string" || !plan.id.trim() || seen.has(plan.id) ||
        typeof plan.network !== "string" || !plan.network.trim() || typeof plan.networkCode !== "string" || !plan.networkCode.trim() ||
        typeof plan.name !== "string" || !plan.name.trim() || typeof plan.publishedAmountKobo !== "number" ||
        !Number.isSafeInteger(plan.publishedAmountKobo) || plan.publishedAmountKobo <= 0 ||
        !(plan.dataType === undefined || plan.dataType === null || typeof plan.dataType === "string")) {
      incomplete = true; continue;
    }
    seen.add(plan.id);
    plans.push({ id: plan.id, network: plan.network, networkCode: plan.networkCode, name: plan.name,
      publishedAmountKobo: plan.publishedAmountKobo, dataType: typeof plan.dataType === "string" ? plan.dataType : null });
  }
  // The server counts what it could not read; a partial catalogue is reported
  // rather than presented as the whole thing.
  if (body.incomplete === true) incomplete = true;
  if (Array.isArray(body.emptyNetworks)) {
    for (const name of body.emptyNetworks) if (typeof name === "string" && name.trim()) emptyNetworks.push(name.trim());
  }
  const checkedAt = typeof body.checkedAt === "string" && Number.isFinite(Date.parse(body.checkedAt)) ? body.checkedAt : null;
  const checkoutReason = typeof body.checkoutReason === "string" && body.checkoutReason.trim()
    ? body.checkoutReason : "Purchasing is unavailable from this catalogue.";
  if (!checkedAt || typeof body.stale !== "boolean" || checkoutReason !== body.checkoutReason) incomplete = true;
  return { plans, checkedAt, stale: body.stale !== false, checkoutReason, incomplete, emptyNetworks };
}

export function DataPlansForm({ initialPlanId }: DataPlansFormProps) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [error, setError] = useState("");
  const [errorReason, setErrorReason] = useState<CatalogueFailureReason | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const retryBlocked = useRetryCooldown(retryAt);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [network, setNetwork] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetchCatalogue("/api/airtime/plans", controller.signal, { timeoutMs: SHARED_CATALOGUE_TIMEOUT_MS })
      .then(async response => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          if (!controller.signal.aborted) {
            setErrorReason(catalogueFailureReason(response.status, body?.code));
            setRetryAt(retryAfterDeadline(response.headers?.get("retry-after") ?? null, response.status === 429 ? 60_000 : 0));
          }
          throw new Error(typeof body?.error === "string" ? body.error : "Unable to load data plans.");
        }
        const next = readCatalogue(body);
        if (!next || (body.plans.length > 0 && next.plans.length === 0)) throw new Error("The data catalogue could not be read.");
        if (!controller.signal.aborted) { setCatalogue(next); setErrorReason(null); }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error && reason.name !== "TimeoutError" ? reason.message : "Unable to load data plans. Please check your connection.");
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
      <button className="rounded-lg border border-line p-3 text-meta font-semibold disabled:opacity-50" disabled={loading || retryBlocked || errorReason === "unconfigured" || errorReason === "sign-in"} onClick={() => { setLoading(true); setError(""); setErrorReason(null); setRetryAt(0); setReload(value => value + 1); }}>Reload listings</button>
    </div>
    {catalogue && <QuickShortcuts
      label="Quick network shortcuts"
      title="Find a network:"
      description="Network names come from the loaded catalogue; stock is not reported and listings may change."
      options={networks.map(([code, name]) => ({ key: code, label: name }))}
      selected={network || null}
      onSelect={(code) => { setNetwork((current) => current === code ? "" : code); setSearch(""); }}
      onClear={() => setNetwork("")}
      clearLabel="All networks"
      alwaysShowClear
    />}
    {loading && <p role="status">Loading current bundles…</p>}
    {error && <p role="alert">{errorReason === "sign-in" ? <>Your session has expired. <Link className="underline" href="/login?next=%2Fdashboard%2Fdata">Sign in again</Link>.</> : error}{" "}
      {catalogue ? "Previously loaded listings remain below. " : ""}
      {errorReason === "unconfigured" || errorReason === "sign-in" ? "" : retryBlocked ? "Please wait before reloading." : "Use Reload listings to retry."}
    </p>}
    {catalogue && <>
      {catalogue.incomplete && <p role="status" className="text-meta text-amber-800">Some bundles or catalogue details could not be shown. Listings may be incomplete; use Reload listings to try again.</p>}
      {/* A network the catalogue carries no readable bundle for is not an outage,
          and it must not read as "no bundles at all" beside a healthy grid. */}
      {catalogue.emptyNetworks.length > 0 && <p role="status" className="text-meta text-amber-800">No bundles are listed right now for {listNames(catalogue.emptyNetworks)}.</p>}
      <p className="text-meta text-ink-2">{catalogue.checkedAt ? <>Catalogue snapshot: <time dateTime={catalogue.checkedAt}>{new Date(catalogue.checkedAt).toLocaleString()}</time>.</> : "Catalogue snapshot time unavailable."} {catalogue.stale ? "Refresh delayed; these listings may have changed." : ""}</p>
      <p className="rounded-xl border border-line bg-white p-4 text-meta">Prices below are published catalogue prices, not checkout quotes. Numeric stock is not reported. {catalogue.checkoutReason}</p>
      {initialPlanId && <p className="text-meta">Choose a current bundle below; old plan links do not select a different product automatically.</p>}
      <p role="status" className="text-meta">{visible.length} bundles · lowest price first</p>
      {plans.length === 0 ? <p>No data bundles are published right now. Use Reload listings to check again.</p>
        : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{visible.map(plan => <article key={plan.id} className="rounded-xl border border-line bg-white p-4">
        <div className="flex items-center gap-3"><span className="text-meta font-semibold">{plan.network}</span></div>
        <h2 className="mt-3 text-[0.9375rem] font-semibold">{plan.name}</h2>
        <p className="mt-2 font-semibold">{money.format(plan.publishedAmountKobo / 100)}</p>
        {plan.dataType && <p className="mt-1 text-meta">{plan.dataType}</p>}
        <p className="mt-2 text-meta text-ink-2">Currently listed · stock count unavailable</p>
      </article>)}</div>}
      {plans.length > 0 && !visible.length && <p>No matching bundles. Try another network or search.</p>}
    </>}
  </section>;
}
