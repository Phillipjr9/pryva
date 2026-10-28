"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatNaira } from "@/lib/catalog";
import { PlatformBadge, platformFor } from "@/components/PlatformBadge";
import { UnitsStatus } from "@/components/dashboard/UnitsStatus";
import { PaymentLoading } from "@/components/ui/PaymentLoading";
import { PaymentSuccess } from "@/components/ui/PaymentSuccess";
import Link from "next/link";

type Listing = { slug: string; title: string; category: string; price: number; stock: number; owned: number };

export function DemoAccountsBrowser({ initialListings }: { initialListings: Listing[] }) {
  const router = useRouter();
  const [listings, setListings] = useState(initialListings);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [selected, setSelected] = useState<Listing | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsFunds, setNeedsFunds] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const filtered = useMemo(() => listings.filter((listing) => (category === "All" || listing.category === category) && listing.title.toLowerCase().includes(search.toLowerCase().trim())), [listings, search, category]);

  async function refresh() {
    try {
      const response = await fetch("/api/demo/accounts", { cache: "no-store" });
      const data = await response.json() as { ok?: boolean; simulated?: boolean; listings?: Listing[] };
      if (!response.ok || !data.ok || !data.simulated || !Array.isArray(data.listings)) throw new Error();
      setListings(data.listings);
      setError(null);
    } catch { setError("Could not refresh demo stock. Please try again."); }
  }

  async function purchase() {
    if (!selected || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNeedsFunds(false);
    try {
      requestId.current ??= crypto.randomUUID();
      const [response] = await Promise.all([
        fetch("/api/demo/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: selected.slug, quantity, requestId: requestId.current }) }),
        new Promise((resolve) => setTimeout(resolve, 1600)),
      ]);
      const data = await response.json() as { ok?: boolean; simulated?: boolean; orderId?: string; error?: string };
      if (!response.ok || !data.ok || !data.simulated || !data.orderId) {
        setError(data.error ?? "Could not complete the demo order. Check your orders before retrying.");
        setNeedsFunds(response.status === 402);
        return;
      }
      setSuccess(data.orderId);
      router.refresh();
    } catch { setError("Could not confirm the demo order. Check your orders before retrying."); }
    finally { setBusy(false); inFlight.current = false; }
  }

  return (
    <div>
      <PaymentLoading show={busy} message="Preparing your demo accounts…" />
      <PaymentSuccess show={!!success} title="Demo order complete" message="Your fictional account samples are ready. They are not real logins." redirectUrl={`/dashboard/orders/${success ?? ""}`} redirectDelay={2500} />
      <div className="flex flex-wrap items-center gap-2">
        {["All", "Social", "Email", "Community", "Entertainment"].map((value) => <button type="button" key={value} onClick={() => setCategory(value)} className={`rounded-full border px-3.5 py-1.5 text-[0.8rem] font-medium ${category === value ? "border-lav-600 bg-lav-600 text-white" : "border-line bg-white text-ink-2"}`}>{value === "All" ? "All accounts" : value}</button>)}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <input type="search" aria-label="Search accounts" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search demo accounts" className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[0.88rem] outline-none focus:border-lav-400 sm:max-w-sm" />
        <button type="button" onClick={() => void refresh()} className="text-[0.75rem] font-semibold text-lav-700 hover:underline">Refresh demo stock</button>
      </div>
      {!selected && error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
      {filtered.length === 0 ? <p className="mt-5 rounded-2xl border border-line bg-white p-8 text-center text-sm text-ink-2">No demo accounts match those filters.</p> : <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((listing) => <article key={listing.slug} className="flex flex-col rounded-2xl border border-line bg-white p-4">
          <div className="flex items-center gap-2.5"><PlatformBadge platform={platformFor(listing.title, listing.category, null)} size={34} /><h3 className="text-[0.9rem] font-semibold text-ink">{listing.title}</h3></div>
          <p className="mt-1.5 text-[0.74rem] text-ink-3">{listing.category} · Fictional demo</p>
          <div className="mt-3"><UnitsStatus demo stock={listing.stock} owned={listing.owned} /></div>
          <div className="mt-4 flex items-end justify-between gap-3"><div><p className="text-[1.05rem] font-semibold text-ink">{formatNaira(listing.price)}</p><p className="text-[0.7rem] text-ink-3">per demo account</p></div><button type="button" disabled={listing.stock < 1} onClick={() => { requestId.current = null; setSelected(listing); setQuantity(1); setError(null); }} className="btn btn-primary !px-4 !py-2 !text-[0.75rem] disabled:opacity-40">Try demo</button></div>
        </article>)}
      </div>}
      {selected && !success && <div role="dialog" aria-modal="true" aria-label="Buy demo accounts" className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 backdrop-blur-sm sm:items-center" onClick={(event) => { if (event.target === event.currentTarget && !busy) setSelected(null); }}>
        <div className="w-full max-w-md rounded-2xl border border-line bg-white p-5 shadow-xl">
          <h3 className="text-[1.02rem] font-semibold text-ink">{selected.title}</h3>
          <p className="mt-1 text-[0.8rem] text-ink-2">{formatNaira(selected.price)} per demo account · {selected.stock} demo units left</p>
          <label htmlFor="demo-account-quantity" className="mt-4 block text-[0.8rem] font-semibold">Quantity</label>
          <input id="demo-account-quantity" type="number" min={1} max={Math.min(50, selected.stock)} value={quantity} onChange={(event) => setQuantity(Math.max(1, Math.min(50, selected.stock, Math.floor(Number(event.target.value) || 1))))} className="field mt-1" />
          <p className="mt-4 rounded-xl bg-lav-50 p-3 text-[0.76rem] text-lav-800">Total: <strong>{formatNaira(selected.price * quantity)}</strong> from your demo wallet. The samples are fictional, not usable logins.</p>
          {error && <p role="alert" className="mt-3 text-[0.78rem] text-rose-700">{error} {needsFunds && <Link href="/dashboard/wallet" className="underline">Add demo funds</Link>}</p>}
          <div className="mt-5 flex gap-2"><button type="button" disabled={busy} onClick={() => void purchase()} className="btn btn-primary disabled:opacity-50">Pay {formatNaira(selected.price * quantity)}</button><button type="button" disabled={busy} onClick={() => setSelected(null)} className="btn btn-secondary">Cancel</button></div>
        </div>
      </div>}
    </div>
  );
}
