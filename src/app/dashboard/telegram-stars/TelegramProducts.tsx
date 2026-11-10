"use client";
import { useEffect, useState } from "react";
import { StarsPurchase } from "./StarsPurchase";

type Prices = { stars: { quantity: number; amount: number | null }[]; premium: { months: number; amount: number | null }[] };
const empty: Prices = { stars: [50, 100, 500, 1000, 2500, 5000].map((quantity) => ({ quantity, amount: null })), premium: [3, 6, 12].map((months) => ({ months, amount: null })) };
const display = (amount: number | null) => amount === null ? "Price unavailable" : `₦${amount.toLocaleString("en-NG")}`;

export function TelegramProducts({ userId, available }: { userId: string; available: boolean }) {
  const [tab, setTab] = useState<"stars" | "premium">("stars");
  const [prices, setPrices] = useState<Prices>(empty);
  const [loading, setLoading] = useState(true);
  const [recipient, setRecipient] = useState("");
  const [months, setMonths] = useState(3);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/digital/telegram/prices", { cache: "no-store", signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("Unavailable"); const data = await response.json(); if (!data.ok || !Array.isArray(data.stars) || !Array.isArray(data.premium)) throw new Error("Unavailable"); if (!controller.signal.aborted) setPrices({ stars: data.stars, premium: data.premium }); })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  return <div className="grid min-w-0 gap-4">
    <div aria-label="Telegram products" className="grid max-w-2xl grid-cols-2 gap-2 rounded-2xl border border-line bg-[#fffdfa] p-1.5">
      {(["stars", "premium"] as const).map((item) => <button key={item} type="button" aria-pressed={tab === item} onClick={() => setTab(item)} className={`min-h-11 rounded-xl px-3 text-sm font-semibold transition-colors ${tab === item ? "bg-lav-100 text-lav-800" : "text-ink-2 hover:bg-cream"}`}>{item === "stars" ? "★ Stars" : "✦ Premium"}</button>)}
    </div>
    <p className="max-w-2xl text-meta leading-relaxed text-ink-3">{loading ? "Checking current prices…" : "Displayed prices are indicative and may change. A confirmed quote is required before payment."}</p>
    <div hidden={tab !== "stars"}><StarsPurchase userId={userId} available={available} prices={prices.stars} loadingPrices={loading} /></div>
    <section hidden={tab !== "premium"} className="w-full max-w-2xl space-y-4 rounded-[1.5rem] border border-line bg-[#fffdfa] p-4 sm:p-6">
      <h2 className="text-[1.05rem] font-semibold text-ink">Telegram Premium</h2>
      <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-meta leading-relaxed text-amber-900">Premium ordering is not available yet. Prices shown are indicative, not a guarantee of availability.</p>
      <div><label htmlFor="premium-recipient" className="block text-meta font-semibold text-ink">Recipient Telegram username</label>
        <input id="premium-recipient" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="@username" autoComplete="off" maxLength={33} className="mt-2 min-h-11 w-full rounded-xl border border-line bg-white px-3 py-2 text-ink" />
        <p className="mt-2 text-meta text-ink-2">Use the recipient’s public username, not a phone number or password.</p>
      </div>
      <fieldset><legend className="text-meta font-semibold text-ink">Choose a duration</legend><div className="mt-2 grid gap-2 sm:grid-cols-3">{prices.premium.map((item) => <button key={item.months} type="button" aria-pressed={months === item.months} onClick={() => setMonths(item.months)} className={`min-h-16 rounded-xl border p-3 text-left ${months === item.months ? "border-lav-500 bg-lav-50 text-lav-800" : "border-line bg-white text-ink"}`}><span className="block font-semibold">{item.months} months</span><span className="text-meta">{loading ? "Checking…" : display(item.amount)}</span></button>)}</div></fieldset>
      <button type="button" disabled className="btn btn-primary min-h-11 w-full cursor-not-allowed opacity-50">Premium ordering unavailable</button>
    </section>
  </div>;
}
