"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
type Offer = { id: string; name: string; region: string };
type Quote = { id: string; name: string; region: string; terms: string; amount: number; expiresAt: string };
type Attempt = { quote: Quote; requestId: string };
type Order = { id: string; reference: string; status: string };
export function EsimPurchase({ userId, offers, initialProduct }: { userId: string; offers: Offer[]; initialProduct?: string }) {
  const storageKey = `pryva:fox-esim-attempt:${userId}`;
  const initial = initialProduct === undefined ? offers[0] : offers.find((item) => item.id === initialProduct);
  const [selected, setSelected] = useState(initial?.id ?? "");
  const [quote, setQuote] = useState<Quote | null>(null), [attempt, setAttempt] = useState<Attempt | null>(null), [order, setOrder] = useState<Order | null>(null);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) { const old = JSON.parse(stored) as Attempt; if (old?.quote?.id && old.requestId) { // eslint-disable-next-line react-hooks/set-state-in-effect
        setAttempt(old); } }
      setReady(true);
    } catch { setMessage("Purchase recovery storage is unavailable. Please use another browser."); }
  }, [storageKey]);
  async function getQuote() {
    setBusy(true); setMessage(null); setQuote(null);
    try {
      const response = await fetch("/api/digital/esims/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: selected }) });
      const data = await response.json();
      if (!response.ok || !data.ok) setMessage(data.error ?? "Could not get a quote."); else setQuote(data.quote as Quote);
    } catch { setMessage("Could not get a quote. Try again."); } finally { setBusy(false); }
  }
  async function submit(existing?: Attempt) {
    let current = existing;
    if (!current) {
      if (!quote || Date.parse(quote.expiresAt) <= Date.now()) { setMessage("This quote expired. Get a new quote."); setQuote(null); return; }
      current = { quote, requestId: crypto.randomUUID() };
      try { localStorage.setItem(storageKey, JSON.stringify(current)); } catch { setMessage("Purchase recovery storage is unavailable. Nothing was charged."); return; }
      setAttempt(current);
    }
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/digital/esims/purchase", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quoteId: current.quote.id, requestId: current.requestId }) });
      const data = await response.json();
      if (data.ok && data.order?.id) { setOrder(data.order as Order); if (data.order.status === "delivered" || data.order.status === "refunded") { localStorage.removeItem(storageKey); setAttempt(null); } }
      else setMessage(`${data.error ?? "Could not confirm the purchase."} Check your orders before starting another.`);
    } catch { setMessage("The result is unknown. Recover this attempt or check your orders before buying again."); } finally { setBusy(false); }
  }
  return <section className="rounded-2xl border border-line bg-white p-5 space-y-4">
    {!ready ? <p className="text-meta text-ink-2">{message ?? "Preparing purchase recovery…"}</p> : null}
    {ready && !attempt && !order && offers.length === 0 ? <p role="status">No verified products are available to order right now.</p> : null}
    {ready && !attempt && !order && offers.length > 0 ? <>
      <label htmlFor="esim-product" className="block text-meta font-semibold">Plan and coverage region</label>
      {initialProduct !== undefined && !selected && <p role="status" className="text-meta text-ink-2">That product is no longer available. Select another product to continue.</p>}
      <select id="esim-product" value={selected} onChange={(event) => { setSelected(event.target.value); setQuote(null); }} className="w-full rounded-xl border border-line px-3 py-2"><option value="" disabled>Choose a product</option>{offers.map((offer) => <option key={offer.id} value={offer.id}>{offer.name} — {offer.region}</option>)}</select>
      <button type="button" disabled={busy || !selected} onClick={() => void getQuote()} className="rounded-xl bg-lav-700 px-4 py-3 font-semibold text-white disabled:opacity-50">Get current price</button>
      {quote && <div className="space-y-3 border-t border-line pt-4"><p className="font-semibold">{quote.name} · {quote.region} · ₦{quote.amount.toLocaleString("en-NG")}</p><p className="text-meta text-ink-2">One eSIM profile. Confirm your device supports eSIM and the coverage suits your travel. Payment comes from your wallet; price and availability are rechecked.</p><p className="text-meta text-ink-2 whitespace-pre-wrap">{quote.terms}</p><p className="text-meta text-ink-3">Quote expires {new Date(quote.expiresAt).toLocaleTimeString()}.</p><button type="button" disabled={busy} onClick={() => void submit()} className="rounded-xl bg-lav-700 px-4 py-3 font-semibold text-white disabled:opacity-50">Confirm and pay ₦{quote.amount.toLocaleString("en-NG")}</button></div>}
    </> : null}
    {attempt && !order ? <div className="space-y-3"><p className="font-semibold">Purchase attempt saved</p><p className="text-meta text-ink-2">{attempt.quote.name} · {attempt.quote.region}. Recover the original request before ordering again.</p><button type="button" disabled={busy} onClick={() => void submit(attempt)} className="rounded-xl bg-lav-700 px-4 py-3 font-semibold text-white disabled:opacity-50">Recover purchase</button><p className="text-meta text-ink-2">If no order was created and the quote expired, check your orders before starting a new quote.</p><button type="button" disabled={busy} onClick={() => { localStorage.removeItem(storageKey); setAttempt(null); setQuote(null); setMessage(null); }} className="text-meta font-semibold text-lav-700 underline">I checked my orders; start a new quote</button></div> : null}
    {order ? <div className="space-y-3"><p className="font-semibold">{order.status === "delivered" ? "eSIM ready" : order.status === "refunded" ? "Purchase refunded" : "Delivery not yet confirmed"}</p><p className="text-meta text-ink-2">Reference: {order.reference}. Check your order; do not buy again while the outcome is being checked.</p><Link href={`/dashboard/orders/${order.id}`} className="text-meta font-semibold text-lav-700 underline">View order</Link></div> : null}
    {message && ready ? <p role="alert" className="text-meta text-rose-700">{message}</p> : null}
    <Link href="/dashboard/orders" className="text-meta text-ink-3 underline">My orders</Link>
  </section>;
}
