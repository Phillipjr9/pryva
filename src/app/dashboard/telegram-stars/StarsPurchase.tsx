"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";

type Quote = { id: string; amount: number; quantity: number; expiresAt: string };
type Attempt = { quote: Quote; username: string; requestId: string };
type Order = { id: string; reference: string; status: string };

export function StarsPurchase({ userId }: { userId: string }) {
  const storageKey = `pryva:stars-attempt:${userId}`;
  const [quantity, setQuantity] = useState("100");
  const [username, setUsername] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const old = JSON.parse(raw) as Attempt;
        if (old?.quote?.id && old.requestId && old.username) {
          // Recovery always reuses the original key and terms, even if expired.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setAttempt(old);
        }
      }
      setStorageReady(true);
    } catch { setMessage("Purchase recovery storage is unavailable. Please use another browser."); }
  }, [storageKey]);

  async function getQuote(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage(null); setQuote(null);
    try {
      const response = await fetch("/api/digital/telegram-stars/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantity: Number(quantity) }) });
      const data = await response.json();
      if (!response.ok || !data.ok) setMessage(data.error ?? "Could not get a quote.");
      else setQuote(data.quote as Quote);
    } catch { setMessage("Could not get a quote. Try again."); }
    finally { setBusy(false); }
  }

  async function submit(existing?: Attempt) {
    let current = existing;
    if (!current) {
      const clean = username.trim().replace(/^@/, "");
      if (!quote || !/^[A-Za-z0-9_]{5,32}$/.test(clean)) { setMessage("Enter a Telegram username of 5–32 letters, numbers or underscores."); return; }
      if (Date.parse(quote.expiresAt) <= Date.now()) { setMessage("This quote expired. Get a new quote."); setQuote(null); return; }
      current = { quote, username: clean, requestId: crypto.randomUUID() };
      try { localStorage.setItem(storageKey, JSON.stringify(current)); } catch { setMessage("Purchase recovery storage is unavailable. Nothing was charged."); return; }
      setAttempt(current);
    }
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/digital/telegram-stars/purchase", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quoteId: current.quote.id, requestId: current.requestId, username: current.username }) });
      const data = await response.json();
      if (data.ok && data.order?.id) {
        setOrder(data.order as Order);
        if (data.order.status === "delivered" || data.order.status === "refunded") { localStorage.removeItem(storageKey); setAttempt(null); }
      } else {
        setMessage(`${data.error ?? "Could not confirm the purchase."} Check your orders before starting a new purchase.`);
      }
    } catch { setMessage("The result is unknown. Recover this attempt or check your orders before buying again."); }
    finally { setBusy(false); }
  }

  return <section className="rounded-2xl border border-line bg-white p-5 space-y-4">
    {!storageReady ? <p className="text-meta text-ink-2">{message ?? "Preparing secure purchase recovery…"}</p> : null}
    {storageReady && !attempt && !order ? <>
      <form onSubmit={getQuote} className="space-y-3">
        <label htmlFor="stars-quantity" className="block text-meta font-semibold">Number of Stars</label>
        <input id="stars-quantity" type="number" min="1" max="1000000" step="1" required value={quantity} onChange={(e) => { setQuantity(e.target.value); setQuote(null); }} className="w-full rounded-xl border border-line px-3 py-2" />
        <button type="submit" disabled={busy} className="rounded-xl bg-lav-700 px-4 py-3 font-semibold text-white disabled:opacity-50">Get current price</button>
      </form>
      {quote ? <div className="space-y-3 border-t border-line pt-4">
        <p className="font-semibold">{quote.quantity.toLocaleString("en-NG")} Stars · ₦{quote.amount.toLocaleString("en-NG")}</p>
        <p className="text-meta text-ink-3">Quote expires {new Date(quote.expiresAt).toLocaleTimeString()}. Availability and price are rechecked before charging.</p>
        <label htmlFor="stars-username" className="block text-meta font-semibold">Recipient Telegram username</label>
        <input id="stars-username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="@username" autoComplete="off" maxLength={33} className="w-full rounded-xl border border-line px-3 py-2" />
        <p className="text-meta text-ink-2">Check the recipient carefully. Payment comes from your Pryva wallet.</p>
        <button type="button" disabled={busy} onClick={() => void submit()} className="rounded-xl bg-lav-700 px-4 py-3 font-semibold text-white disabled:opacity-50">Confirm and pay ₦{quote.amount.toLocaleString("en-NG")}</button>
      </div> : null}
    </> : null}
    {attempt && !order ? <div className="space-y-3"><p className="font-semibold">Purchase attempt saved</p><p className="text-meta text-ink-2">{attempt.quote.quantity} Stars for @{attempt.username}. Recover this attempt using its original request before placing another.</p><button type="button" disabled={busy} onClick={() => void submit(attempt)} className="rounded-xl bg-lav-700 px-4 py-3 font-semibold text-white disabled:opacity-50">Recover purchase</button><p className="text-meta text-ink-2">If no order was created and the quote expired, check your orders before starting a new quote.</p><button type="button" disabled={busy} onClick={() => { localStorage.removeItem(storageKey); setAttempt(null); setQuote(null); setMessage(null); }} className="text-meta font-semibold text-lav-700 underline">I checked my orders; start a new quote</button></div> : null}
    {order ? <div className="space-y-3"><p className="font-semibold">{order.status === "delivered" ? "Delivery confirmed" : order.status === "refunded" ? "Purchase refunded" : "Delivery not yet confirmed"}</p><p className="text-meta text-ink-2">Reference: {order.reference}. {order.status === "review" || order.status === "processing" ? "Check the order for updates; do not buy again while the outcome is being checked." : ""}</p><Link href={`/dashboard/orders/${order.id}`} className="text-meta font-semibold text-lav-700 underline">View order</Link></div> : null}
    {message && storageReady ? <p role="alert" className="text-meta text-rose-700">{message}</p> : null}
    <p className="text-meta text-ink-3"><Link href="/dashboard/orders" className="underline">My orders</Link> · Prices and availability can change.</p>
  </section>;
}
