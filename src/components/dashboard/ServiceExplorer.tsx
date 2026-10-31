"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BrandIcon } from "@/components/BrandIcon";
import { CountryFlag } from "@/components/CountryFlag";
import { CountrySelector } from "@/components/dashboard/CountrySelector";
import { NetworkBadge } from "@/components/NetworkBadge";
import { ServiceIcon } from "@/components/ServiceIcon";
import { UnitsStatus } from "@/components/dashboard/UnitsStatus";
import { ArrowRight, Globe, Search, Shield, Sparkle } from "@/components/icons";
import { formatNaira } from "@/lib/catalog";
import {
  buildServiceExplorer,
  EXPLORER_CATEGORIES,
  explorerCategory,
  explorerCountry,
  filterExplorerItems,
  interleaveExplorerItems,
  type ExplorerFilter,
  type ExplorerItem,
} from "@/lib/service-explorer";

const PAGE_SIZE = 12;

/** Echoed link values are untrusted input: keep them short and let React escape them. */
function truncate(value: string) {
  const clean = value.trim();
  return clean.length > 24 ? `${clean.slice(0, 24)}\u2026` : clean;
}
const VERIFICATION_TAGS = ["Social", "Messaging", "Finance", "Travel", "Entertainment", "Work & other", "Other"];
const SOCIAL_TAGS = [
  "Followers",
  "Likes",
  "Views",
  "Subscribers",
  "Comments",
  "Shares",
  "Saves",
  "Members",
  "Plays",
  "Watch time",
  "Reactions",
];

const CATEGORY_ICONS: Record<string, string> = {
  verification: "💬",
  social: "🚀",
  numbers: "📱",
  esim: "🌐",
  proxies: "🛡️",
  email: "✉️",
  accounts: "👤",
  subscriptions: "🎬",
  data: "📶",
  tools: "⚙️",
};

const POPULAR_COUNTRIES = [
  { code: "ng", name: "Nigeria", desc: "Local numbers & data" },
  { code: "us", name: "United States", desc: "US numbers & proxies" },
  { code: "gb", name: "United Kingdom", desc: "UK verification numbers" },
  { code: "ca", name: "Canada", desc: "Canadian plans" },
  { code: "gh", name: "Ghana", desc: "Regional African plans" },
];

function itemArt(item: ExplorerItem) {
  switch (item.artwork.kind) {
    case "brand": return <BrandIcon brand={item.artwork.name} size={42} decorative />;
    case "network": return <NetworkBadge provider={item.artwork.name} size={42} />;
    case "service": return <ServiceIcon service={item.artwork.name} size="md" />;
  }
}

function ServiceCard({ item, countryName }: { item: ExplorerItem; countryName: string }) {
  const coverage = item.source === "live"
      ? (item.coverage === "catalog-country" ? `Reported region: ${countryName}` : "Not country-specific")
      : item.coverage === "catalog-country" ? `Catalog region: ${countryName}` : item.coverage === "unconfirmed" ? "Country coverage unconfirmed" : "Not filtered by country";
  const noAction = item.source === "live" ? "Ordering paused" : item.source === "example" ? "Not connected" : "Not available";
  const action = item.action;
  const price = item.price;

  return (
    <article className="group flex h-full min-w-0 flex-col rounded-2xl border border-line bg-white p-4 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-lav-300 hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-lav-50/70">{itemArt(item)}</div>
        <span className={`rounded-full px-2.5 py-1 text-micro font-bold uppercase tracking-[0.08em] ${
          item.source === "live"
            ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
            : item.source === "example"
            ? "border border-lav-200 bg-lav-50 text-lav-700"
            : item.source === "tool"
            ? "border border-indigo-200 bg-indigo-50 text-indigo-700"
            : "border border-line bg-cream-2 text-ink-2"
        }`}>
          {item.source === "live" ? "Live listing" : item.source === "example" ? "Example" : item.source === "tool" ? "Tool" : "Catalog"}
        </span>
      </div>
      <div className="mt-3 min-w-0">
        <h3 className="break-words text-[0.92rem] font-semibold leading-snug text-ink">{item.name}</h3>
        <p className="mt-1 text-meta text-ink-3">{item.description} · <span className="capitalize">{item.tag}</span></p>
      </div>
      <p className="mt-3 text-micro leading-relaxed text-ink-3">{coverage}</p>
      <div className="mt-auto pt-3">
        <p className="min-h-[1.2rem] text-meta font-semibold text-ink">
          {price !== null ? `${item.source === "live" ? "Indicative" : "Listed"} ${item.priceFrom ? "from " : "price "}${formatNaira(price)}` : item.source === "example" ? "Price not connected" : "See details"}
        </p>
        <div className="mt-2"><UnitsStatus stock={item.stock} owned={item.myUnits} /></div>
        {action ? (
          <Link href={action.href} className="mt-3 flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-lav-200 bg-lav-50 px-3 py-2 text-center text-meta font-semibold text-lav-800 transition-colors hover:border-lav-400 hover:bg-lav-100">
            {action.label} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <button type="button" disabled className="mt-3 flex min-h-10 w-full items-center justify-center rounded-xl border border-line bg-cream/60 px-3 py-2 text-meta font-semibold text-ink-3/80 disabled:cursor-not-allowed">
            {noAction}
          </button>
        )}
      </div>
    </article>
  );
}

/** Keep country and category shareable, and allow Back to restore the choice. */
function writeSelection(country: string, category: ExplorerFilter) {
  const params = new URLSearchParams();
  if (country) params.set("country", country);
  if (category !== "all") params.set("category", category);
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ""}`;
  if (next !== `${window.location.pathname}${window.location.search}`) window.history.pushState(null, "", next);
}

export function ServiceExplorer({ initialCountry, initialCategory, rejectedCountry = null, rejectedCategory = null }: {
  initialCountry: string | null;
  initialCategory: string | null;
  /** Link values the server could not honour, echoed so the reset is visible. */
  rejectedCountry?: string | null;
  rejectedCategory?: string | null;
}) {
  const [country, setCountry] = useState(() => explorerCountry(initialCountry)?.code ?? "");
  const [category, setCategory] = useState<ExplorerFilter>(() => explorerCategory(initialCategory));
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("all");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [liveState, setLiveState] = useState<{ country: string; items: ExplorerItem[]; partial: boolean; failed: boolean; fetchedAt: string | null } | null>(null);
  const [liveRevision, setLiveRevision] = useState(0);
  const selectedCountry = explorerCountry(country);
  const selectedCategory = EXPLORER_CATEGORIES.find((entry) => entry.id === category);
  const items = useMemo(() => {
    const base = buildServiceExplorer(country);
    return liveState?.country === country && liveState.items.length
      ? interleaveExplorerItems([...liveState.items, ...base]) : base;
  }, [country, liveState]);
  const filtered = useMemo(() => filterExplorerItems(items, category, search, tag), [items, category, search, tag]);
  const tags = category === "verification" ? VERIFICATION_TAGS : category === "social" ? SOCIAL_TAGS : [];

  // Live listings: boosts are purchasable, the others are read-only until their ordering is wired.
  useEffect(() => {
    if (!country) return;
    const controller = new AbortController();
    fetch(`/api/services/catalog?country=${encodeURIComponent(country)}${liveRevision ? "&refresh=1" : ""}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { ok?: boolean; country?: string; partial?: boolean; fetchedAt?: string; items?: ExplorerItem[] };
        if (!response.ok || !data.ok || data.country !== country || !Array.isArray(data.items)) throw new Error("Catalog unavailable");
        const fetchedAt = typeof data.fetchedAt === "string" && Number.isFinite(Date.parse(data.fetchedAt)) ? data.fetchedAt : null;
        if (!controller.signal.aborted) setLiveState({ country, items: data.items, partial: Boolean(data.partial), failed: false, fetchedAt });
      })
      .catch(() => { if (!controller.signal.aborted) setLiveState({ country, items: [], partial: false, failed: true, fetchedAt: null }); });
    return () => controller.abort();
  }, [country, liveRevision]);

  // Handle browser back/forward when a history entry from another page is restored.
  useEffect(() => {
    function restoreSelection() {
      const params = new URLSearchParams(window.location.search);
      setCountry(explorerCountry(params.get("country"))?.code ?? "");
      setCategory(explorerCategory(params.get("category")));
      setSearch("");
      setTag("all");
      setVisible(PAGE_SIZE);
    }
    window.addEventListener("popstate", restoreSelection);
    return () => window.removeEventListener("popstate", restoreSelection);
  }, []);

  function chooseCountry(code: string) {
    const next = explorerCountry(code)?.code ?? "";
    setCountry(next);
    if (next !== country) setLiveRevision(0);
    setTag("all");
    setSearch("");
    setVisible(PAGE_SIZE);
    writeSelection(next, category);
  }

  function chooseCategory(next: ExplorerFilter) {
    setCategory(next);
    setTag("all");
    setSearch("");
    setVisible(PAGE_SIZE);
    writeSelection(country, next);
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-micro font-bold uppercase tracking-[0.16em] text-lav-700">Explore Pryva</p>
          <h1 className="mt-1 text-[1.6rem] font-semibold leading-tight text-ink sm:text-[1.9rem]">{selectedCategory?.label ?? "Your service hub"}</h1>
          <p className="mt-1.5 max-w-2xl text-[0.82rem] leading-relaxed text-ink-2">{selectedCategory ? `${selectedCategory.description}. Choose a country, then select a service below.` : "Choose a country, then browse categories and service examples in one place."}</p>
        </div>
        <Link href="/dashboard/orders" className="inline-flex items-center gap-1 text-meta font-semibold text-lav-700 hover:underline">My orders <ArrowRight className="h-3.5 w-3.5" /></Link>
      </div>

      {rejectedCountry || rejectedCategory ? (
        <p role="status" className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-meta leading-relaxed text-amber-900">
          <Shield className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            That link asked for{rejectedCountry ? <> country <strong className="font-semibold">&ldquo;{truncate(rejectedCountry)}&rdquo;</strong></> : null}
            {rejectedCountry && rejectedCategory ? " and" : null}
            {rejectedCategory ? <> category <strong className="font-semibold">&ldquo;{truncate(rejectedCategory)}&rdquo;</strong></> : null},
            which isn&rsquo;t something we list, so the selection was reset instead of guessing. Pick a country below.
          </span>
        </p>
      ) : null}

      <section aria-labelledby="choose-country-title" className="relative overflow-hidden rounded-[1.5rem] border border-lav-200/80 bg-[#f6f1fc] p-5 sm:p-6">
        <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-20 h-48 w-48 rounded-full bg-lav-300/30 blur-3xl" />
        <div className="relative grid gap-4 md:grid-cols-[1fr_1.1fr] md:items-center">
          <div>
            <p className="inline-flex items-center gap-1.5 text-micro font-bold uppercase tracking-[0.16em] text-lav-700"><Globe className="h-3.5 w-3.5" /> Step 01</p>
            <h2 id="choose-country-title" className="mt-2 text-[1.25rem] font-semibold text-ink">Start with a country.</h2>
            <p className="mt-1.5 max-w-sm text-meta leading-relaxed text-ink-2">Select where you need the service. Boosts can be ordered right away; other listings still need their coverage confirmed before ordering.</p>
          </div>
          <div className="rounded-2xl border border-white/80 bg-white/60 p-4 shadow-sm">
            <CountrySelector id="service-country" value={country} onChange={chooseCountry} />
          </div>
        </div>
      </section>

      {!selectedCountry ? (
        <div className="rounded-[1.5rem] border border-dashed border-lav-200 bg-white/70 px-6 py-10 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-lav-50 text-lav-700"><Globe className="h-5 w-5" /></span>
          <h2 className="mt-3 text-[1rem] font-semibold text-ink">Choose a country to explore</h2>
          <p className="mx-auto mt-1.5 max-w-md text-[0.8rem] leading-relaxed text-ink-2">We&apos;ll show the service categories and example plans after you make your selection.</p>
          <div className="mx-auto mt-6 grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-3">
            {POPULAR_COUNTRIES.map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => chooseCountry(c.code)}
                className="flex flex-col items-center justify-center rounded-2xl border border-line bg-white p-3.5 transition-all hover:-translate-y-0.5 hover:border-lav-300 hover:shadow-xs"
              >
                <CountryFlag code={c.code} size={28} decorative />
                <span className="mt-2 text-[0.85rem] font-semibold text-ink">{c.name}</span>
                <span className="mt-0.5 text-micro text-ink-3">{c.desc}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <section aria-labelledby="categories-title" className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-micro font-bold uppercase tracking-[0.16em] text-lav-700">Step 02</p>
                <h2 id="categories-title" className="mt-1 text-[1.05rem] font-semibold text-ink">Choose a category</h2>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-meta font-semibold text-ink-2">
                <CountryFlag code={selectedCountry.code} size={18} decorative radius={9} /> {selectedCountry.name}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2" aria-label="Service categories">
              <button type="button" onClick={() => chooseCategory("all")} aria-pressed={category === "all"} className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-meta font-semibold transition-colors ${category === "all" ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-2 hover:border-lav-300"}`}>
                <span aria-hidden="true">⚡</span> All categories
              </button>
              {EXPLORER_CATEGORIES.map((entry) => (
                <button key={entry.id} type="button" title={entry.description} onClick={() => chooseCategory(entry.id)} aria-pressed={category === entry.id} className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-meta font-semibold transition-colors ${category === entry.id ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-2 hover:border-lav-300"}`}>
                  <span aria-hidden="true">{CATEGORY_ICONS[entry.id] ?? "✨"}</span> {entry.label}
                </button>
              ))}
            </div>
          </section>

          <div role="note" className={`flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-meta leading-relaxed border-amber-200 bg-amber-50/70 text-amber-900`}>
            <Shield className="mt-0.5 h-4 w-4 shrink-0" />
            {liveState?.country === country && !liveState.failed ? <p><strong>Live listings are current.</strong> Boosting services can be bought now, from your wallet. Plan and eSIM listings are still indicative until ordering is switched on for them, and examples are separate. {liveState.partial && "Some listing types are temporarily unavailable. "}<Link href="/dashboard/orders" className="font-semibold underline underline-offset-2">View existing orders</Link>.</p> : <p><strong>Examples, not a verified live catalog.</strong> Stock is unknown and purchased service units aren&apos;t tracked yet. Country coverage is unverified. <Link href="/dashboard/orders" className="font-semibold underline underline-offset-2">View existing orders</Link>.</p>}
          </div>

          <section aria-labelledby="services-title" className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="inline-flex items-center gap-1.5 text-micro font-bold uppercase tracking-[0.16em] text-lav-700"><Sparkle className="h-3.5 w-3.5" /> Step 03</p>
                <h2 id="services-title" className="mt-1 text-[1.05rem] font-semibold text-ink">{selectedCategory ? `Explore ${selectedCategory.label}` : "Explore services"}</h2>
                <p aria-live="polite" className="mt-1 text-meta text-ink-3">{filtered.length} {`listing${filtered.length === 1 ? "" : "s"} and examples`} · {selectedCountry.name} selected</p>
                {liveState?.country === country && liveState.fetchedAt && <p className="mt-1 text-micro text-ink-3">Stock checked: <time dateTime={liveState.fetchedAt}>{new Date(liveState.fetchedAt).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}</time></p>}
              </div>
              <div className="relative w-full sm:max-w-[260px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
                <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setVisible(PAGE_SIZE); }} aria-label="Search services" placeholder="Search services or platforms" className="min-h-11 w-full rounded-xl border border-line bg-white py-2 pl-9 pr-3 text-meta text-ink outline-none placeholder:text-ink-3 focus:border-lav-400 focus:ring-4 focus:ring-lav-100" />
              </div>
            </div>

            {tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-4" aria-label="Service types">
                <button type="button" onClick={() => { setTag("all"); setVisible(PAGE_SIZE); }} aria-pressed={tag === "all"} className={`rounded-lg px-2.5 py-1.5 text-micro font-semibold ${tag === "all" ? "bg-lav-100 text-lav-800" : "text-ink-3 hover:bg-cream"}`}>All types</button>
                {tags.map((type) => <button key={type} type="button" onClick={() => { setTag(type); setVisible(PAGE_SIZE); }} aria-pressed={tag === type} className={`rounded-lg px-2.5 py-1.5 text-micro font-semibold ${tag === type ? "bg-lav-100 text-lav-800" : "text-ink-3 hover:bg-cream"}`}>{type}</button>)}
              </div>
            )}

            {liveState?.country === country && (liveState.failed || liveState.partial) && <p role="status" className="mt-4 text-meta text-amber-800">Some live listings couldn&apos;t be loaded. <button type="button" className="font-semibold underline" onClick={() => setLiveRevision((value) => value + 1)}>Retry</button></p>}
            <div className="mt-4 grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-3">
              {filtered.slice(0, visible).map((item) => <ServiceCard key={item.id} item={item} countryName={selectedCountry.name} />)}
            </div>
            {filtered.length === 0 && (
              <div className="rounded-2xl border border-dashed border-line bg-cream/50 p-8 text-center">
                <p className="text-[0.88rem] font-semibold text-ink">No examples match these filters</p>
                <p className="mt-1 text-meta text-ink-2">Try another search, category or country. This doesn&apos;t indicate live availability.</p>
                {(search || tag !== "all") && <button type="button" onClick={() => { setSearch(""); setTag("all"); setVisible(PAGE_SIZE); }} className="mt-3 text-meta font-semibold text-lav-700 underline underline-offset-2">Clear filters</button>}
              </div>
            )}
            {visible < filtered.length && (
              <div className="mt-5 text-center">
                <button type="button" onClick={() => setVisible((current) => current + PAGE_SIZE)} className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2.5 text-meta font-semibold text-ink-2 transition-colors hover:border-lav-300 hover:text-lav-700">Show more <span className="text-ink-3">({filtered.length - visible} remaining)</span></button>
              </div>
            )}
            <p className="mt-5 border-t border-line pt-4 text-micro leading-relaxed text-ink-3">Stock means available inventory. My units means your remaining purchased units. Unknown and not tracked are not the same as zero. Examples do not imply platform support or verified coverage.</p>
          </section>
        </>
      )}
    </div>
  );
}
