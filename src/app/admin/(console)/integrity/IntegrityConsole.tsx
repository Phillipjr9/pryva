"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle, Refresh, Shield } from "@/components/icons";
import { AdminCard, EmptyState } from "@/components/admin/AdminUi";

type Result = { users: { checked: number; issues: number }; orders: { checked: number; issues: number }; generatedAt: string };
export function IntegrityConsole() {
  const [scope, setScope] = useState("all");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setPending(true); setError(null);
    try {
      const response = await fetch(`/api/admin/integrity?scope=${scope}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.ok || !body.summary?.users || !body.summary?.orders) throw new Error(body.error || "The check could not finish. Try again.");
      setResult({ users: body.summary.users, orders: body.summary.orders, generatedAt: body.generatedAt });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The check could not finish. Try again."); }
    finally { setPending(false); }
  }
  return <AdminCard title="Read-only consistency check" subtitle="Checks run on demand. No balances or orders are changed.">
    <div className="d-flex flex-wrap align-items-end gap-3 mb-4"><label className="d-flex flex-column gap-2" style={{ fontSize: ".75rem" }}>Scope<select className="form-select" value={scope} onChange={(event) => setScope(event.target.value)} disabled={pending}><option value="all">Wallets and orders</option><option value="wallet">Wallets only</option><option value="orders">Orders only</option></select></label><button type="button" className="btn btn-primary" onClick={() => void run()} disabled={pending}><Refresh className={pending ? "animate-spin" : ""} />{pending ? "Checking…" : "Run integrity check"}</button></div>
    {error && <div role="alert" className="info-note mb-3"><AlertTriangle /><span>{error}</span></div>}
    <div aria-live="polite" aria-busy={pending}>{result ? <div className="row g-3">{([{ key: "users", label: "Wallets checked" }, { key: "orders", label: "Orders checked" }] as const).map(({ key, label }) => <div className="col-sm-6" key={key}><div className="info-note"><span className={`queue-icon tone-${result[key].issues ? "danger" : "success"}`}>{result[key].issues ? <AlertTriangle /> : <CheckCircle />}</span><span><strong className="d-block" style={{ color: "var(--pc-text)", fontSize: "1.2rem" }}>{result[key].checked}</strong>{label}<span className="d-block mt-1">{result[key].checked === 0 ? "Not included in this check" : `${result[key].issues} ${result[key].issues === 1 ? "issue" : "issues"} found`}</span></span></div></div>)}<p className="mb-0 mt-3" style={{ color: "var(--pc-muted)", fontSize: ".7rem" }}>Completed {new Date(result.generatedAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC. Review any issues in reconciliation before taking action.</p></div> : <EmptyState title={pending ? "Checking your records…" : "Ready to check"} description="Run a check to see wallet and order consistency. Large datasets may take a little longer." icon={<Shield />} />}</div>
  </AdminCard>;
}
