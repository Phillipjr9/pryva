"use client";

import { useEffect, useState } from "react";
import type { CloudflareOverview, CountGroup } from "@/lib/admin/cloudflare-analytics";

const AUTH_PATH = /^\/(?:signup|login)(?:\/|$)|^\/api\/auth\/(?:signup|login|google)(?:\/|$)/i;
const selectClass = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink";

function GroupList({ title, rows }: { title: string; rows: CountGroup[] }) {
  return <div className="rounded-xl border border-line bg-cream p-3">
    <h4 className="font-semibold text-ink">{title}</h4>
    {rows.length === 0 ? <p className="mt-2 text-sm text-ink-2">No data returned.</p> : <ul className="mt-2 space-y-1 text-sm">{rows.map((row, i) => <li key={`${row.label}-${i}`} className="flex justify-between gap-3"><span className="min-w-0 break-all text-ink-2">{row.label}</span><span className="shrink-0 font-medium text-ink">{row.count.toLocaleString()}</span></li>)}</ul>}
  </div>;
}

export function CloudflareSecurity() {
  const [data, setData] = useState<CloudflareOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [loadedAt, setLoadedAt] = useState(0);
  const [hours, setHours] = useState("24");
  const [country, setCountry] = useState("");
  const [action, setAction] = useState("");
  const [search, setSearch] = useState("");
  const [authOnly, setAuthOnly] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/security/cloudflare", { cache: "no-store", signal: controller.signal })
      .then(async (res) => { if (!res.ok) throw new Error("unavailable"); return res.json() as Promise<CloudflareOverview>; })
      .then((body) => { if (!controller.signal.aborted) { setData(body); setLoadedAt(Date.now()); setError(""); } })
      .catch(() => { if (!controller.signal.aborted) { setData(null); setError("Could not load Cloudflare data. Please try again."); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);

  const traffic = data?.traffic?.status === "ready" ? data.traffic.data : null;
  const events = data?.events?.status === "ready" ? data.events.data : null;
  const max = Math.max(1, ...(traffic?.map((row) => row.requests) ?? []));
  const countries = [...new Set(events?.map((event) => event.country).filter(Boolean) ?? [])].sort();
  const actions = [...new Set(events?.map((event) => event.action).filter(Boolean) ?? [])].sort();
  const term = search.trim().toLowerCase();
  const filtered = events?.filter((event) => {
    const timestamp = Date.parse(event.datetime);
    return Number.isFinite(timestamp) && timestamp >= loadedAt - Number(hours) * 3_600_000 &&
      (!country || event.country === country) && (!action || event.action === action) &&
      (!authOnly || AUTH_PATH.test(event.path)) &&
      (!term || [event.ip, event.path, event.source].some((value) => value.toLowerCase().includes(term)));
  });
  return (
    <section className="rounded-2xl border border-line bg-white p-5" aria-labelledby="cloudflare-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="cloudflare-title" className="text-lg font-semibold text-ink">Cloudflare edge activity</h2>
          <p className="mt-1 text-sm text-ink-2">Requests reaching Cloudflare and recent security decisions, separate from Pryva app reports.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button type="button" disabled={loading} className="rounded-lg border border-line px-3 py-2 font-medium disabled:opacity-50" onClick={() => { setLoading(true); setRefresh((n) => n + 1); }}>Refresh</button>
          <a className="font-medium text-lav-700 underline" href="https://dash.cloudflare.com/" target="_blank" rel="noreferrer">Open Cloudflare ↗</a>
        </div>
      </div>
      {loading && <p className="mt-4 text-sm text-ink-2">Loading Cloudflare activity…</p>}
      {error && <p role="alert" className="mt-4 text-sm text-rose-700">{error}</p>}
      {!loading && data && !data.configured && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><strong>Cloudflare analytics not connected.</strong> Add the zone ID and a zone-scoped Analytics Read token to the server environment, then redeploy. Turnstile uses separate credentials and does not connect this dashboard. Preview deployments do not access production analytics.</div>}
      {!loading && data?.configured && <div className="mt-5 space-y-6">
        <div>
          <h3 className="font-semibold text-ink">Traffic · last 24 complete hours (UTC)</h3>
          {data.traffic?.status === "unavailable" && <p className="mt-2 text-sm text-amber-800">Traffic analytics unavailable. Check token permissions, zone, and Cloudflare plan.</p>}
          {traffic && <>
            <p className="mt-1 text-sm text-ink-2">{traffic.reduce((sum, row) => sum + row.requests, 0).toLocaleString()} requests · {(traffic.reduce((sum, row) => sum + row.bytes, 0) / 1_000_000).toFixed(2)} MB transferred. Requests are not people.</p>
            {traffic.length ? <div className="mt-3 flex h-28 items-end gap-1" aria-label="Hourly Cloudflare requests">{traffic.map((row) => <div key={row.datetime} className="flex min-w-0 flex-1 items-end" title={`${row.datetime}: ${row.requests.toLocaleString()} requests`}><div className="w-full rounded-t bg-lav-500" style={{ height: `${Math.max(1, row.requests / max * 100)}px` }} /></div>)}</div> : <p className="mt-2 text-sm text-ink-2">Cloudflare returned no hourly traffic for this interval.</p>}
          </>}
        </div>
        <div>
          <h3 className="font-semibold text-ink">Traffic breakdown · rolling 24 hours</h3>
          <p className="mt-1 text-sm text-ink-2">Top countries and paths and response status codes. These counts may be sampled or estimated and can differ from hourly totals; paths exclude query strings.</p>
          {data.trafficBreakdown?.status === "unavailable" && <p className="mt-2 text-sm text-amber-800">Traffic breakdown unavailable for this token or Cloudflare plan.</p>}
          {data.trafficBreakdown?.status === "ready" && <div className="mt-3 grid gap-3 md:grid-cols-3"><GroupList title="Countries · top 10" rows={data.trafficBreakdown.data.countries} /><GroupList title="Paths · top 10" rows={data.trafficBreakdown.data.paths} /><GroupList title="Response codes · up to 50" rows={data.trafficBreakdown.data.statuses} /></div>}
        </div>
        <div>
          <h3 className="font-semibold text-ink">Security summary · rolling 24 hours</h3>
          <p className="mt-1 text-sm text-ink-2">Cloudflare security decisions, not successful attacks. Counts may be sampled or estimated; a challenge does not mean it was passed or blocked.</p>
          {data.securityBreakdown?.status === "unavailable" && <p className="mt-2 text-sm text-amber-800">Security summary unavailable for this token or Cloudflare plan.</p>}
          {data.securityBreakdown?.status === "ready" && <div className="mt-3 grid gap-3 md:grid-cols-3"><GroupList title="Actions · up to 20" rows={data.securityBreakdown.data.actions} /><GroupList title="Services · up to 20" rows={data.securityBreakdown.data.services} /><GroupList title="Rule IDs · top 10" rows={data.securityBreakdown.data.rules} /></div>}
        </div>
        <div>
          <h3 className="font-semibold text-ink">Recent security events</h3>
          <p className="mt-1 text-sm text-ink-2">Up to {data.eventLimit} events from the last 24 hours; filters search only these loaded events, not all Cloudflare traffic. Data may be sampled or limited. Country alone is not evidence of abuse.</p>
          {data.events?.status === "unavailable" && <p className="mt-2 text-sm text-amber-800">Security events unavailable. Check token permissions, zone, and Cloudflare plan.</p>}
          {events && <>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">Time<select className={selectClass} value={hours} onChange={(e) => setHours(e.target.value)}><option value="24">Last 24 hours</option><option value="6">Last 6 hours</option><option value="1">Last hour</option></select></label>
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">Country<select className={selectClass} value={country} onChange={(e) => setCountry(e.target.value)}><option value="">All countries</option>{countries.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">Action<select className={selectClass} value={action} onChange={(e) => setAction(e.target.value)}><option value="">All actions</option>{actions.map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-2">IP, path or service<input className={selectClass} value={search} maxLength={200} onChange={(e) => setSearch(e.target.value)} placeholder="Search loaded events" /></label>
              <label className="flex items-center gap-2 py-2 text-sm text-ink-2"><input type="checkbox" checked={authOnly} onChange={(e) => setAuthOnly(e.target.checked)} /> Signup / login paths</label>
            </div>
            {authOnly && <p className="mt-2 text-xs text-ink-2">Includes Google auth, which serves signup and login. Events are requests, not successful signups or proof of abuse.</p>}
            <p className="mt-3 text-sm text-ink-2">Showing {filtered?.length ?? 0} of {events.length} loaded events.</p>
            {!filtered?.length ? <p className="mt-3 text-sm text-ink-2">No loaded events match these filters.</p> : <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-line text-ink-2"><th className="p-2">Time (UTC)</th><th className="p-2">Action</th><th className="p-2">Service</th><th className="p-2">Country</th><th className="p-2">IP</th><th className="p-2">Path</th></tr></thead><tbody>{filtered.map((event, i) => <tr className="border-b border-line" key={`${event.datetime}-${i}`}><td className="whitespace-nowrap p-2">{event.datetime}</td><td className="p-2">{event.action}</td><td className="p-2">{event.source}</td><td className="p-2">{event.country || "—"}</td><td className="p-2">{event.ip || "—"}</td><td className="max-w-xs break-all p-2">{event.path || "—"}</td></tr>)}</tbody></table></div>}
          </>}
        </div>
        <p className="text-sm text-ink-2">Blocking controls are not connected. Review and change IP or country rules in Cloudflare; broad rules may block you, legitimate users or payment webhooks. Direct Vercel access may bypass Cloudflare.</p>
      </div>}
    </section>
  );
}
