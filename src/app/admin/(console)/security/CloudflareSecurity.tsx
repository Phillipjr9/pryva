"use client";

import { useEffect, useState } from "react";
import type { CloudflareOverview } from "@/lib/admin/cloudflare-analytics";

export function CloudflareSecurity() {
  const [data, setData] = useState<CloudflareOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/security/cloudflare", { cache: "no-store", signal: controller.signal })
      .then(async (res) => { if (!res.ok) throw new Error("unavailable"); return res.json() as Promise<CloudflareOverview>; })
      .then((body) => { if (!controller.signal.aborted) { setData(body); setError(""); } })
      .catch(() => { if (!controller.signal.aborted) { setData(null); setError("Could not load Cloudflare data. Please try again."); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);

  const traffic = data?.traffic?.status === "ready" ? data.traffic.data : null;
  const events = data?.events?.status === "ready" ? data.events.data : null;
  const max = Math.max(1, ...(traffic?.map((row) => row.requests) ?? []));
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
      {!loading && data?.configured && <div className="mt-5 space-y-5">
        <div>
          <h3 className="font-semibold text-ink">Traffic · last 24 complete hours (UTC)</h3>
          {data.traffic?.status === "unavailable" && <p className="mt-2 text-sm text-amber-800">Traffic analytics unavailable. Check token permissions, zone, and Cloudflare plan.</p>}
          {traffic && <>
            <p className="mt-1 text-sm text-ink-2">{traffic.reduce((sum, row) => sum + row.requests, 0).toLocaleString()} requests · {(traffic.reduce((sum, row) => sum + row.bytes, 0) / 1_000_000).toFixed(2)} MB transferred. Requests are not people.</p>
            {traffic.length ? <div className="mt-3 flex h-28 items-end gap-1" aria-label="Hourly Cloudflare requests">
              {traffic.map((row) => <div key={row.datetime} className="flex min-w-0 flex-1 items-end" title={`${row.datetime}: ${row.requests.toLocaleString()} requests`}><div className="w-full rounded-t bg-lav-500" style={{ height: `${Math.max(1, row.requests / max * 100)}px` }} /></div>)}
            </div> : <p className="mt-2 text-sm text-ink-2">Cloudflare returned no hourly traffic for this interval.</p>}
          </>}
        </div>
        <div>
          <h3 className="font-semibold text-ink">Recent security events</h3>
          <p className="mt-1 text-sm text-ink-2">Up to {data.eventLimit} events from the last 24 hours; data may be sampled or limited by Cloudflare. A challenge is not necessarily a block. Country alone is not evidence of abuse.</p>
          {data.events?.status === "unavailable" && <p className="mt-2 text-sm text-amber-800">Security events unavailable. Check token permissions, zone, and Cloudflare plan.</p>}
          {events && (events.length === 0 ? <p className="mt-3 text-sm text-ink-2">Cloudflare returned no security events for this period.</p> :
            <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-line text-ink-2"><th className="p-2">Time</th><th className="p-2">Action</th><th className="p-2">Service</th><th className="p-2">Country</th><th className="p-2">IP</th><th className="p-2">Path</th></tr></thead><tbody>{events.map((event, i) => <tr className="border-b border-line" key={`${event.datetime}-${i}`}><td className="p-2 whitespace-nowrap">{event.datetime}</td><td className="p-2">{event.action}</td><td className="p-2">{event.source}</td><td className="p-2">{event.country || "—"}</td><td className="p-2">{event.ip || "—"}</td><td className="max-w-xs break-all p-2">{event.path || "—"}</td></tr>)}</tbody></table></div>)}
        </div>
        <p className="text-sm text-ink-2">Blocking controls are not connected. Review and change IP or country rules in Cloudflare; broad rules may block you, legitimate users or payment webhooks. Direct Vercel access may bypass Cloudflare.</p>
      </div>}
    </section>
  );
}
