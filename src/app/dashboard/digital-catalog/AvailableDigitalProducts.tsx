"use client";

import Link from "next/link";
import { useState } from "react";

type Kind = "codes" | "topups" | "esims";
type Offer = { id: string; name: string; region: string; kind: Kind };
const labels: Record<Kind, string> = { codes: "Digital code", topups: "Account top-up", esims: "Travel eSIM" };
const PAGE_SIZE = 24;

/** Reviewed products only. A quote still rechecks supplier price and stock. */
export function AvailableDigitalProducts({ offers, starsEnabled }: { offers: Offer[]; starsEnabled: boolean }) {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<Kind | "all">("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const needle = search.trim().toLocaleLowerCase();
  const filtered = offers.filter((offer) => (kind === "all" || offer.kind === kind) && (!needle || `${offer.name} ${offer.region}`.toLocaleLowerCase().includes(needle)));
  const showStars = starsEnabled && (kind === "all" || kind === "topups") && (!needle || "telegram stars".includes(needle));
  return <section aria-labelledby="available-digital" className="rounded-2xl border border-line bg-white p-4 sm:p-6">
    <h2 id="available-digital" className="text-xl font-semibold text-ink">Shop digital products</h2>
    <p className="mt-2 text-meta text-ink-2">Products configured for checkout appear here. Price and availability are confirmed with a fresh quote before payment.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <div><label htmlFor="available-search" className="block text-meta font-semibold text-ink">Find a product or region</label><input id="available-search" type="search" value={search} maxLength={128} onChange={(event) => { setSearch(event.target.value); setLimit(PAGE_SIZE); }} className="mt-2 min-h-11 w-full rounded-xl border border-line px-3 py-2" placeholder="Search products" /></div>
      <div><label htmlFor="available-kind" className="block text-meta font-semibold text-ink">Product type</label><select id="available-kind" value={kind} onChange={(event) => { setKind(event.target.value as Kind | "all"); setLimit(PAGE_SIZE); }} className="mt-2 min-h-11 w-full rounded-xl border border-line px-3 py-2"><option value="all">All types</option><option value="codes">Codes and game keys</option><option value="topups">Account top-ups</option><option value="esims">Travel eSIMs</option></select></div>
    </div>
    {filtered.length || showStars ? <ul className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {showStars && <li className="rounded-xl border border-line p-3"><div className="flex items-center gap-3"><p className="font-semibold text-ink">Telegram Stars</p></div><p className="text-meta text-ink-3">Account top-up</p><Link href="/dashboard/telegram-stars" className="mt-1 inline-block text-meta font-semibold text-lav-700 underline">Check price and availability</Link></li>}
      {filtered.slice(0, limit).map((offer) => <li key={`${offer.kind}:${offer.id}`} className="rounded-xl border border-line p-3"><div className="flex items-center gap-3"><p className="min-w-0 font-semibold text-ink">{offer.name}</p></div><p className="text-meta text-ink-3">{labels[offer.kind]} · {offer.region}</p><Link href={`/dashboard/digital-${offer.kind}?product=${encodeURIComponent(offer.id)}`} className="mt-1 inline-block text-meta font-semibold text-lav-700 underline">Check price and availability</Link></li>)}
    </ul> : <p className="mt-4 text-meta text-ink-2">{offers.length || starsEnabled ? "No configured products match your search." : "No digital products are currently configured for checkout. You can still explore the catalogue below."}</p>}
    {filtered.length > limit && <button type="button" onClick={() => setLimit((value) => value + PAGE_SIZE)} className="mt-4 rounded-lg border border-line px-3 py-2 text-meta font-semibold">Show more products</button>}
  </section>;
}
