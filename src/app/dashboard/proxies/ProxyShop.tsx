"use client";
import { useEffect, useMemo, useState } from "react";

type Plan = { id: string; label: string; quantity: number; priceNgn: number };
type Country = { code: string; name: string; states: string[] };
type Slot = { id: string; country: string; state: string | null; status: string; expiresAt: string | null; orderId: string; reference: string };
type Catalogue = { plans: Plan[]; countries: Country[]; expiryHours: number };
const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

export function ProxyShop() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [planId, setPlanId] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [state, setState] = useState("Random");
  const [proxyType, setProxyType] = useState<2 | 3>(2);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [credentials, setCredentials] = useState<Record<string, { host: string; port: number; username: string; password: string; url: string }>>({});
  const selectedPlan = catalogue?.plans.find((plan) => plan.id === planId) ?? null;
  const selectedCountry = catalogue?.countries.find((country) => country.code === countryCode) ?? null;
  const states = useMemo(() => selectedCountry?.states ?? [], [selectedCountry]);

  async function loadSlots() {
    const response = await fetch("/api/proxies/orders", { cache: "no-store" });
    const body = await response.json();
    if (response.ok && Array.isArray(body.slots)) setSlots(body.slots);
  }
  useEffect(() => {
    let active = true;
    fetch("/api/proxies/plans", { cache: "no-store" }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Proxy plans are unavailable.");
      return body as Catalogue;
    }).then((data) => {
      if (!active) return;
      setCatalogue(data);
      setPlanId(data.plans[0]?.id ?? "");
      const country = data.countries.find((entry) => entry.code === "NG") ?? data.countries[0];
      setCountryCode(country?.code ?? "");
      setState(country?.states.includes("Random") ? "Random" : country?.states[0] ?? "");
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load proxy plans."); });
    fetch("/api/proxies/orders", { cache: "no-store" }).then((response) => response.json()).then((body) => {
      if (active && Array.isArray(body.slots)) setSlots(body.slots);
    }).catch(() => { /* Orders can be retried after the catalogue has loaded. */ });
    return () => { active = false; };
  }, []);

  async function purchase() {
    if (!selectedPlan || !selectedCountry) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/proxies/purchase", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: selectedPlan.id, country: selectedCountry.code, state, proxyType, requestId: crypto.randomUUID(), expectedPriceNgn: selectedPlan.priceNgn }),
      });
      const body = await response.json();
      if (!response.ok && response.status !== 202) throw new Error(body.error || "Purchase could not be confirmed.");
      setMessage(body.order?.status === "active" ? "Proxy order placed. Extract each slot to activate it and view credentials." : "Your order needs reconciliation. Check Orders; do not submit another purchase.");
      await loadSlots();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Purchase could not be confirmed."); }
    finally { setBusy(false); }
  }

  async function extract(slotId: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/proxies/orders/${encodeURIComponent(slotId)}/extract`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Credentials could not be retrieved.");
      setCredentials((previous) => ({ ...previous, [slotId]: body.slot.credentials }));
      await loadSlots();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Credentials could not be retrieved."); }
    finally { setBusy(false); }
  }

  async function reveal(slotId: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/proxies/orders/${encodeURIComponent(slotId)}/reveal`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Credentials could not be retrieved.");
      if (body.slot?.credentials) setCredentials((previous) => ({ ...previous, [slotId]: body.slot.credentials }));
      else setError("This slot does not currently have active credentials.");
      await loadSlots();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Credentials could not be retrieved."); }
    finally { setBusy(false); }
  }

  return <div className="space-y-8">
    <section className="rounded-2xl border border-line bg-white p-5 sm:p-7">
      <h1 className="text-2xl font-semibold text-ink">Residential proxies</h1>
      <p className="mt-2 max-w-3xl text-meta leading-relaxed text-ink-2">Choose a live plan, country and proxy format. Each purchased IP is a slot; extract it to activate and receive its credentials. Slots last up to {catalogue?.expiryHours ?? 6} hours.</p>
      {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-meta text-rose-800">{error}</p>}
      {message && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-meta text-emerald-800">{message}</p>}
      {!catalogue ? <p role="status" className="mt-5">Loading current plans…</p> : <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="text-meta font-medium">Plan<select className="mt-1 block w-full rounded-xl border border-line bg-white p-3" value={planId} onChange={(event) => setPlanId(event.target.value)}>{catalogue.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.label} · {plan.quantity} IP{plan.quantity === 1 ? "" : "s"} · {money.format(plan.priceNgn)}</option>)}</select></label>
        <label className="text-meta font-medium">Country<select className="mt-1 block w-full rounded-xl border border-line bg-white p-3" value={countryCode} onChange={(event) => { const nextCode = event.target.value; const nextCountry = catalogue.countries.find((entry) => entry.code === nextCode); setCountryCode(nextCode); setState(nextCountry?.states.includes("Random") ? "Random" : nextCountry?.states[0] ?? ""); }}>{catalogue.countries.map((country) => <option key={country.code} value={country.code}>{country.name} ({country.code})</option>)}</select></label>
        <label className="text-meta font-medium">State / region<select className="mt-1 block w-full rounded-xl border border-line bg-white p-3" value={state} onChange={(event) => setState(event.target.value)}>{states.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
        <label className="text-meta font-medium">Connection format<select className="mt-1 block w-full rounded-xl border border-line bg-white p-3" value={proxyType} onChange={(event) => setProxyType(Number(event.target.value) as 2 | 3)}><option value={2}>HTTP / HTTPS · host:port:user:pass</option><option value={3}>SOCKS5 · user:pass@host:port</option></select></label>
        <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-cream p-4"><div><p className="font-semibold">{selectedPlan ? money.format(selectedPlan.priceNgn) : "—"}</p><p className="text-meta text-ink-2">Final price shown before checkout; each IP slot activates only when extracted.</p></div><button type="button" disabled={busy || !selectedPlan || !selectedCountry} onClick={purchase} className="rounded-xl bg-lav-700 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Working…" : "Buy proxy"}</button></div>
      </div>}
    </section>
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Your proxy slots</h2>
      {!slots.length ? <p className="rounded-xl border border-line bg-white p-4 text-meta text-ink-2">No proxy slots yet.</p> : slots.map((slot) => {
        const credential = credentials[slot.id];
        return <article key={slot.id} className="rounded-2xl border border-line bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold">{slot.country}{slot.state ? ` · ${slot.state}` : ""} · {slot.status}</p><p className="text-meta text-ink-2">Order {slot.reference}{slot.expiresAt ? ` · expires ${new Date(slot.expiresAt).toLocaleString()}` : ""}</p></div>
            {slot.status === "purchased" ? <button type="button" disabled={busy} onClick={() => extract(slot.id)} className="rounded-lg bg-lav-700 px-4 py-2 text-meta font-semibold text-white disabled:opacity-50">Extract credentials</button> : slot.status === "active" ? <button type="button" disabled={busy} onClick={() => reveal(slot.id)} className="rounded-lg border border-line px-4 py-2 text-meta font-semibold disabled:opacity-50">Reveal credentials</button> : null}
          </div>
          {credential && <dl className="mt-4 grid gap-2 rounded-xl bg-slate-50 p-3 text-meta sm:grid-cols-2"><div><dt className="text-ink-3">Host</dt><dd className="break-all font-mono">{credential.host}</dd></div><div><dt className="text-ink-3">Port</dt><dd className="font-mono">{credential.port}</dd></div><div><dt className="text-ink-3">Username</dt><dd className="break-all font-mono">{credential.username}</dd></div><div><dt className="text-ink-3">Password</dt><dd className="break-all font-mono">{credential.password}</dd></div><div className="sm:col-span-2"><dt className="text-ink-3">Connection string</dt><dd className="break-all font-mono">{credential.url}</dd></div></dl>}
        </article>;
      })}
    </section>
  </div>;
}
