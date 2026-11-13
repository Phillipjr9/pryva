"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DataPlansForm } from "@/app/dashboard/data/DataPlansForm";
import { DigitalCategoryPicker } from "@/components/dashboard/DigitalCategoryPicker";
import { useLiveServiceExplorer, type LiveState } from "@/components/dashboard/useLiveServiceExplorer";
import { useDigitalExplorer } from "@/components/dashboard/useDigitalExplorer";
import { QuickShortcuts, type QuickShortcut } from "@/components/QuickShortcuts";
import { CountrySelector } from "@/components/dashboard/CountrySelector";
import { UnitsStatus } from "@/components/dashboard/UnitsStatus";

import { formatNaira } from "@/lib/services/catalog";
import { formatUnitCount } from "@/lib/services/service-units";
import { explorerShortcuts, shortcutForExplorerItem } from "@/lib/services/quick-shortcuts";
import {
  orderByReadiness,
  readinessSummary,
  SERVICE_STATE_LABEL,
  type ServiceReadinessEntry,
} from "@/lib/services/service-states";
import {
  buildServiceExplorer,
  EXPLORER_CATEGORIES,
  explorerCategory,
  explorerCountry,
  filterExplorerItems,
  mergeExplorerSources,
  type ExplorerCategory,
  type ExplorerFilter,
  type ExplorerItem,
} from "@/lib/services/service-explorer";

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
const NUMBER_TAGS = ["Single use", "Rental", "Bundle"];
const DATA_TAGS = ["MTN", "Airtel", "Glo", "9mobile"];

/** Group related services in the compact category picker. */
const SERVICE_CATEGORY_GROUPS: ReadonlyArray<{
  id: string;
  label: string;
  categories: readonly ExplorerCategory[];
}> = [
  {
    id: "connectivity",
    label: "Phone & connectivity",
    categories: ["numbers", "verification", "esim", "data", "proxies"],
  },
  {
    id: "digital-products",
    label: "Digital products & accounts",
    categories: ["accounts", "subscriptions", "games", "topups", "gift-cards", "prepaid"],
  },
  {
    id: "growth-tools",
    label: "Growth & everyday tools",
    categories: ["social", "email", "tools"],
  },
];

const POPULAR_COUNTRIES = [
  { code: "ng", name: "Nigeria", desc: "Local numbers & data" },
  { code: "us", name: "United States", desc: "US numbers & proxies" },
  { code: "gb", name: "United Kingdom", desc: "UK verification numbers" },
  { code: "ca", name: "Canada", desc: "Canadian plans" },
  { code: "gh", name: "Ghana", desc: "Regional African plans" },
];

export function ServiceCard({ item, countryName }: { item: ExplorerItem; countryName: string }) {
  const coverage = item.source === "live"
      ? (item.coverage === "catalog-country" ? `Reported region: ${countryName}` : item.coverage === "unconfirmed" ? "Country coverage unconfirmed" : "Not country-specific")
      : item.coverage === "catalog-country" ? `Catalog region: ${countryName}` : item.coverage === "unconfirmed" ? "Country coverage unconfirmed" : "Not filtered by country";
  const noAction = item.orderingPaused ? "Ordering paused" : item.category === "verification" && item.source === "live"
    ? "Purchasing locked"
    : item.source === "live" ? "Ordering paused" : "Not available";
  const action = item.action;
  const price = item.price;
  const sourceLabel = item.source === "live" ? "Live listing" : item.source === "tool" ? "Tool" : "Catalog";
  const sourceTone = item.source === "live"
    ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
    : item.source === "tool"
    ? "border border-indigo-200 bg-indigo-50 text-indigo-700"
    : "border border-line bg-cream-2 text-ink-2";
  const priceLine = price !== null
    ? `${item.source === "live" ? "Indicative" : "Listed"} ${item.priceFrom ? "from " : "price "}${formatNaira(price)}`
    : item.category === "verification" && item.source === "live"
      ? "Purchasing locked"
      : item.category === "esim" && item.source === "live" ? "Price unavailable" : "See details";

  /* A single text-first card keeps the name, source and action readable on
     phones without duplicating the listing for different breakpoints. */
  return (
    <article className="group flex min-w-0 flex-col items-stretch gap-2.5 rounded-xl border border-line bg-white p-2.5 shadow-xs transition-all duration-200 hover:border-lav-300 sm:h-full sm:gap-0 sm:rounded-2xl sm:p-4 sm:hover:-translate-y-0.5 sm:hover:shadow-md">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <h3 className="min-w-0 break-words text-[0.875rem] font-semibold leading-snug text-ink sm:whitespace-normal sm:text-[0.9375rem]">{item.name}</h3>
          <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-micro font-bold uppercase tracking-[0.08em] ${sourceTone}`}>
            {sourceLabel}
          </span>
        </div>
        {/* One price line for every width: a phone needs the same figures as a
            desktop, and a second hidden copy would be read out twice. */}
        <p className="mt-0.5 break-words text-micro text-ink-3">
          <span className="capitalize">{item.tag}</span>
          {" · "}
          <span>{priceLine}</span>
        </p>
        {/* OTP stock is the live count for this app's selected pool. Keep it
            visible on phones too; hiding UnitsStatus at the mobile breakpoint made
            a live listing look empty even when the count was positive. */}
        {item.category === "verification" && item.source === "live" && (
          <p className="mt-0.5 break-words text-micro text-ink-3 sm:hidden">
            <span className="font-semibold">Stocks left:</span> {formatUnitCount(item.stock, "Not reported")}
          </p>
        )}
        <p className="mt-1 hidden text-meta text-ink-3 sm:block">{item.description}</p>
        {/* Variants of one product differ by refill and order bounds, so a phone
            needs that line as much as a desktop does — one node, not two. */}
        <p className="mt-0.5 break-words text-micro leading-relaxed text-ink-3 sm:mt-3">{item.detail ?? coverage}</p>
      </div>
      <div className="w-full sm:mt-auto sm:pt-3">
        <div className="hidden sm:mt-2 sm:block"><UnitsStatus stock={item.stock} owned={item.myUnits} /></div>
        {action ? (
          <Link
            href={action.href}
            aria-label={action.label}
            className="flex min-h-11 w-full items-center justify-center rounded-xl border border-lav-200 bg-lav-50 px-2.5 py-2 text-center text-micro font-semibold leading-snug text-lav-800 [overflow-wrap:anywhere] transition-colors hover:border-lav-400 hover:bg-lav-100 sm:mt-3 sm:min-h-10 sm:w-full sm:px-3 sm:text-meta"
          >
            <span>{action.label}</span>

          </Link>
        ) : (
          <button
            type="button"
            disabled
            aria-label={noAction}
            title={noAction}
            className="flex min-h-11 w-full items-center justify-center rounded-xl border border-line bg-cream/60 px-2.5 py-2 text-center text-micro font-semibold leading-snug text-ink-3 [overflow-wrap:anywhere] disabled:cursor-not-allowed sm:mt-3 sm:min-h-10 sm:w-full sm:px-3 sm:text-meta"
          >
            <span>{noAction}</span>

          </button>
        )}
      </div>
    </article>
  );
}

/** Preserve the checkout identity while returning shoppers to the shelf they used. */
function numberPlansOffer(item: ExplorerItem, countryCode: string): ExplorerItem {
  if (!item.action) return item;
  const locked = { ...item, action: null };
  if (!/^otp-[a-f0-9]{24}$/.test(item.id)) return locked;
  try {
    const url = new URL(item.action.href, "https://catalog.invalid");
    if (url.origin !== "https://catalog.invalid" || url.pathname !== `/dashboard/services/otp/${item.id}` ||
        url.searchParams.getAll("country").length !== 1 || url.searchParams.get("country") !== countryCode) return locked;
    url.searchParams.set("from", "numbers");
    return { ...item, action: { ...item.action, href: `${url.pathname}${url.search}${url.hash}` } };
  } catch {
    return locked;
  }
}

/** The verification feed is also the app-specific part of Number plans. Keep
 * its status separate from rentals and retain every offer's own checkout link. */
function NumberAppOffers({
  countryName, countryCode, feed, pending, search, shortcutKey, retryBlocked, onRetry,
}: {
  countryName: string;
  countryCode: string;
  feed: LiveState | null;
  pending: boolean;
  search: string;
  shortcutKey: string | null;
  retryBlocked: boolean;
  onRetry: () => void;
}) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [openGroups, setOpenGroups] = useState(() => new Map<string, boolean>());
  const [visibleOffers, setVisibleOffers] = useState(() => new Map<string, number>());
  const groups = useMemo(() => {
    // This is the verification feed, not similarly named digital products or a
    // hand-written app list. A name groups options visually but never merges or
    // discards their individual price, stock, ID or action.
    // Pending or missing feeds are not proof of country coverage, even if a
    // cached or malformed payload happens to contain rows.
    const entries = filterExplorerItems(!pending && feed?.live ? feed.items : [], "verification", shortcutKey ? "" : search)
      .filter((item) => item.source === "live" && item.coverage === "catalog-country" && (!shortcutKey || shortcutForExplorerItem(item)?.key === shortcutKey));
    const byName = new Map<string, { name: string; items: ExplorerItem[] }>();
    for (const item of entries) {
      const key = item.name.trim().toLocaleLowerCase();
      const group = byName.get(key);
      if (group) group.items.push(item);
      else byName.set(key, { name: item.name, items: [item] });
    }
    return [...byName.entries()].map(([key, group]) => ({ key, ...group }));
  }, [feed, pending, search, shortcutKey]);
  const offers = groups.reduce((total, group) => total + group.items.length, 0);
  const retryable = feed?.reason === "error" || feed?.reason === "throttled";
  const unconfirmed = !feed || !feed.live || feed.failed || feed.partial;
  const cachedWarning = groups.length > 0 && unconfirmed && ["sign-in", "unconfigured", "environment", "funding", "throttled"].includes(feed?.reason ?? "");

  return (
    <section aria-labelledby="number-apps-title" aria-busy={pending || undefined} className="mt-5 rounded-2xl border border-lav-200 bg-lav-50/40 p-3 sm:p-4">
      <h3 id="number-apps-title" className="text-[0.9375rem] font-semibold text-ink">Apps for single-use numbers</h3>
      <p className="mt-1 text-meta text-ink-2">Choose a service to see its reported number offers for {countryName}. Availability and platform acceptance can change.</p>
      <div aria-live="polite" className="mt-2 text-meta text-ink-3">
        {groups.length > 0 && <p>{groups.length} {groups.length === 1 ? "service" : "services"} · {offers} {offers === 1 ? "offer" : "offers"}{unconfirmed ? " shown" : ""}</p>}
        {pending ? <p>Loading app listings for {countryName}…</p>
          : feed?.reason === "sign-in" ? <p>Your session has expired. <Link href="/login?next=%2Fdashboard%2Fservices" className="font-semibold underline">Sign in again</Link> to load apps.</p>
          : feed?.reason === "unconfigured" ? <p>App listings are not connected yet.</p>
          : feed?.reason === "environment" ? <p>App listings are unavailable in this environment.</p>
          : feed?.reason === "funding" ? <p>App listings are paused while we restock.</p>
          : feed?.reason === "throttled" ? <p>App listings were requested too quickly. Please wait before retrying.</p>
          : unconfirmed ? <p>{groups.length ? "App listings may be incomplete or out of date." : "App listings are temporarily unavailable."}</p>
          : groups.length === 0 ? <p>{search.trim() ? `No app listings match your search for ${countryName}.` : `No app listings were reported for ${countryName}.`}</p>
          : null}
        {cachedWarning && <p>App listings may be incomplete or out of date.</p>}
        {feed?.fetchedAt && <p>Apps checked: <time dateTime={feed.fetchedAt}>{new Date(feed.fetchedAt).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}</time></p>}
        {!pending && retryable && <button type="button" onClick={onRetry} disabled={retryBlocked} className="mt-1 font-semibold text-lav-700 underline disabled:opacity-50">Retry apps</button>}
      </div>
      <div className="mt-3 grid gap-2">
        {groups.slice(0, visible).map((group, index) => {
          const open = openGroups.get(group.key) ?? (index === 0 || !!search.trim());
          const limit = visibleOffers.get(group.key) ?? PAGE_SIZE;
          const panelId = `number-app-options-${index}`;
          return (
            <div key={group.key} className="overflow-hidden rounded-xl border border-line bg-white">
              <h4 className="m-0">
                <button type="button" aria-expanded={open} aria-controls={open ? panelId : undefined}
                  onClick={() => setOpenGroups((current) => new Map(current).set(group.key, !open))}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-cream/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-lav-400">
                  <span className="min-w-0 flex-1 break-words font-semibold text-ink">{group.name}</span>
                  <span className="shrink-0 text-micro text-ink-3">{group.items.length} {group.items.length === 1 ? "option" : "options"}</span>
                  <span className="shrink-0 text-micro font-semibold text-lav-700">{open ? "Hide" : "Show"}</span>
                </button>
              </h4>
              {open && <div id={panelId} className="border-t border-line p-2.5">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {group.items.slice(0, limit).map((item) => <ServiceCard key={item.id} item={numberPlansOffer(item, countryCode)} countryName={countryName} />)}
                </div>
                {limit < group.items.length && <button type="button" onClick={() => setVisibleOffers((current) => new Map(current).set(group.key, limit + PAGE_SIZE))}
                  className="mt-3 rounded-full border border-line px-3 py-2 text-micro font-semibold text-ink-2">More options for {group.name} ({group.items.length - limit} remaining)</button>}
              </div>}
            </div>
          );
        })}
      </div>
      {visible < groups.length && <button type="button" onClick={() => setVisible((current) => current + PAGE_SIZE)}
        className="mt-3 rounded-full border border-line bg-white px-4 py-2.5 text-meta font-semibold text-ink-2 hover:border-lav-300">Show more apps ({groups.length - visible} remaining)</button>}
    </section>
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

/**
 * What the live catalogue request did, in the customer's terms.
 *
 * The three "not live" cases are deliberately distinct: an environment with
 * live listings switched off and a deployment with no live integration are
 * both steady states, so they must not read as breakage or offer a Retry that
 * cannot change the answer. Only `error` and `throttled` are worth retrying.
 */

function liveUnavailableCopy(reason: LiveState["reason"]) {
  if (reason === "environment") return {
    lead: "Live availability is off in this environment.",
    rest: "Stock and coverage below come from the catalogue, so check each listing before ordering.",
  };
  if (reason === "unconfigured") return {
    lead: "Live availability isn\'t connected yet.",
    rest: "Stock and coverage below come from the catalogue, so check each listing before ordering.",
  };
  if (reason === "throttled") return {
    lead: "Live listings were refreshed too quickly.",
    rest: "Give it a minute and press Retry; the listings below are unaffected.",
  };
  if (reason === "sign-in") return {
    lead: "Your session has expired.",
    rest: "Sign in again to load live listings.",
  };
  if (reason === "funding") return {
    // Out of stock at the source, not out of order. Nothing here is the
    // customer's to fix, and no amount of retrying restocks it.
    lead: "Live listings are paused while we restock.",
    rest: "Nothing is wrong with your account or your orders; check back soon.",
  };
  if (reason === "error") return {
    lead: "Live listings are refreshing.",
    rest: "Live listings may be incomplete or out of date. Browse the catalogue below while the live feed syncs again.",
  };
  return {
    lead: "Live availability is not shown yet.",
    rest: "Check each listing for availability; stock and country coverage may be unconfirmed.",
  };
}

const SERVICE_COUNTRY_STORAGE_KEY = "pryva:selected-country";

function resolveExplorerCountry(initialCountry: string | null) {
  const explicit = explorerCountry(initialCountry)?.code;
  if (explicit) return explicit;
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(SERVICE_COUNTRY_STORAGE_KEY);
      const remembered = explorerCountry(stored)?.code;
      if (remembered) return remembered;
    } catch { /* Storage can be blocked; browsing and explicit country choices still work. */ }
  }
  return "ng";
}

export function ServiceExplorer({
  initialCountry,
  initialCategory,
  rejectedCountry = null,
  rejectedCategory = null,
  readiness = [],
  initialAllEsimDestinations = false,
  reviewedItems = [],
  enableDigitalCatalogue = false,
}: {
  initialCountry: string | null;
  initialCategory: string | null;
  /** Link values the server could not honour, echoed so the reset is visible. */
  rejectedCountry?: string | null;
  rejectedCategory?: string | null;
  /**
   * What each category can actually do, computed by the server from the same
   * configuration the checkout reads. Absent in unit tests, where the hub still
   * renders — just without the labels.
   */
  readiness?: ServiceReadinessEntry[];
  initialAllEsimDestinations?: boolean;
  reviewedItems?: ExplorerItem[];
  enableDigitalCatalogue?: boolean;
}) {
  const [allEsimDestinations, setAllEsimDestinations] = useState(initialAllEsimDestinations);
  // Server and first browser render must agree. Restore a remembered country
  // after hydration, before displaying or requesting country-specific offers.
  const [country, setCountry] = useState(() => explorerCountry(initialCountry)?.code ?? "ng");
  const [countryReady, setCountryReady] = useState(() => !!explorerCountry(initialCountry));
  const [category, setCategory] = useState<ExplorerFilter>(() => explorerCategory(initialCategory));
  const [search, setSearch] = useState("");
  // Keep the catalogue's current query while a shortcut filters loaded items.
  // This avoids restarting paginated reads or losing an existing search page.
  const [quickSelection, setQuickSelection] = useState<(QuickShortcut & { catalogueSearch: string }) | null>(null);
  const [tag, setTag] = useState("all");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [platformOpen, setPlatformOpen] = useState<Record<string, boolean>>({});
  const [groupVisible, setGroupVisible] = useState<Record<string, number>>({});
  const [liveRevision, setLiveRevision] = useState(0);
  const liveState = useLiveServiceExplorer(country, liveRevision, category === "esim" && allEsimDestinations, category, countryReady && category !== "data");
  const [stockOnly, setStockOnly] = useState(true);
  const selectedCountry = explorerCountry(country);
  const selectedCategory = EXPLORER_CATEGORIES.find((entry) => entry.id === category);
  const [subcategory, setSubcategory] = useState<{ id: string; name: string; root?: string } | null>(null);
  const digital = useDigitalExplorer(enableDigitalCatalogue && countryReady && category !== "data", category, quickSelection?.catalogueSearch ?? search, stockOnly, subcategory);
  const items = useMemo(() => {
    const base = subcategory ? [] : buildServiceExplorer(country);
    // Retain the feed's category metadata, but prefer the reviewed checkout for
    // the same opaque product ID. Never deduplicate by similar product names.
    const reviewedById = new Map(reviewedItems.map((item) => [item.id, item]));
    const catalogue = digital.items.map((item) => {
      const reviewed = reviewedById.get(item.id);
      return reviewed && !item.orderingPaused ? { ...item, action: reviewed.action } : item;
    });
    const loadedIds = new Set(catalogue.map((item) => item.id));
    return mergeExplorerSources([
      !subcategory && liveState?.country === country ? liveState.items : [], base, catalogue,
      subcategory ? [] : reviewedItems.filter((item) => !loadedIds.has(item.id)),
    ]);
  }, [country, liveState, digital.items, reviewedItems, subcategory]);
  // An unresolved or failed verification feed is not a zero-stock result. The
  // hook can be null for the first render or immediately after a country switch.
  const verificationPending = category === "verification" && !!selectedCountry && (!liveState || liveState.country !== country || liveState.loading);
  const verificationUnavailable = category === "verification" && !verificationPending && !!liveState &&
    (!liveState.live || liveState.failed || liveState.partial);
  const appFeed = liveState?.verificationFeed ?? null;
  const numberAppsPending = category === "numbers" && (!liveState || !appFeed || liveState.verificationLoading);
  const numberAppsUnconfirmed = category === "numbers" && !!appFeed && (!appFeed.live || appFeed.failed || appFeed.partial);

  // Only actual, settled live feeds can contribute app shortcuts. In particular,
  // an unconnected feed's malformed rows or a previous country's results must
  // never become an implied platform listing. Partial/cached feeds keep their
  // existing warnings and do not imply stock or checkout availability.
  const shortcutLiveIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [feed, pending] of [
      [liveState?.verificationFeed, liveState?.verificationLoading],
      [liveState?.socialFeed, liveState?.socialLoading],
      [liveState?.numbersFeed, liveState?.numbersLoading],
    ] as const) {
      if (feed?.live && !pending) for (const item of feed.items) ids.add(item.id);
    }
    return ids;
  }, [liveState]);
  const quickChoices = useMemo(() => {
    const candidates = category === "numbers"
      ? !numberAppsPending && appFeed?.live ? appFeed.items : []
      : filterExplorerItems(items, category, "");
    return explorerShortcuts(candidates.filter((item) => item.source !== "live" || shortcutLiveIds.has(item.id)));
  }, [items, category, numberAppsPending, appFeed, shortcutLiveIds]);
  const filtered = useMemo(() => {
    const matches = filterExplorerItems(items, category, quickSelection ? "" : search, tag);
    return quickSelection ? matches.filter((item) => (item.source !== "live" || shortcutLiveIds.has(item.id)) && shortcutForExplorerItem(item)?.key === quickSelection.key) : matches;
  }, [items, category, search, tag, quickSelection, shortcutLiveIds]);
  /**
   * Social promotion lists every offer in the live catalogue, which is hundreds
   * rather than a handful. Grouping by platform keeps that navigable: each one
   * collapses to a header with its count and opens to its own paginated grid.
   * The server already orders by platform, so insertion order is the shelf order.
   */
  const platformGroups = useMemo(() => {
    if (category !== "social") return null;
    const groups = new Map<string, ExplorerItem[]>();
    for (const item of filtered) {
      const key = item.platform ?? "Other platforms";
      const bucket = groups.get(key);
      if (bucket) bucket.push(item);
      else groups.set(key, [item]);
    }
    return [...groups.entries()].map(([platform, entries]) => ({ platform, items: entries }));
  }, [category, filtered]);
  // A search or a type filter must reveal its own matches, so filtering opens
  // every section regardless of what was collapsed while browsing.
  const filtering = search.trim().length > 0 || tag !== "all";
  const tags = category === "verification"
    ? VERIFICATION_TAGS
    : category === "social"
    ? SOCIAL_TAGS
    : category === "numbers"
    ? NUMBER_TAGS
    : category === "data"
    ? DATA_TAGS
    : [];

  const readinessById = useMemo(() => new Map(readiness.map((entry) => [entry.id, entry])), [readiness]);
  const selectedReadiness = category === "all" ? null : readinessById.get(category) ?? null;
  // Categories a customer can act on come first; ties keep the catalogue order.
  // The constant itself is untouched, so links and tests stay stable.
  const orderedCategories = useMemo(() => {
    // Ordering is derived here as well as on the server: the prop arrives
    // sorted, but a component that reorders silently when handed a different
    // array is one refactor away from putting an unconnected category first.
    const entries = EXPLORER_CATEGORIES.map((entry) => ({
      entry,
      state: readinessById.get(entry.id)?.state ?? ("unavailable" as const),
      known: readinessById.has(entry.id),
    }));
    const known = orderByReadiness(entries.filter((item) => item.known)).map((item) => item.entry);
    const unknown = entries.filter((item) => !item.known).map((item) => item.entry);
    return [...known, ...unknown];
  }, [readinessById]);
  const summary = readinessSummary(readiness);


  useEffect(() => {
    if (countryReady) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      setCountry(resolveExplorerCountry(null));
      setCountryReady(true);
    });
    return () => { active = false; };
  }, [countryReady]);

  useEffect(() => {
    if (!countryReady) return;
    try { window.localStorage.setItem(SERVICE_COUNTRY_STORAGE_KEY, country); }
    catch { /* Remembering a preference is optional, not a reason to crash. */ }
  }, [country, countryReady]);

  // Handle browser back/forward when a history entry from another page is restored.
  useEffect(() => {
    function restoreSelection() {
      const params = new URLSearchParams(window.location.search);
      setCountry(explorerCountry(params.get("country"))?.code ?? resolveExplorerCountry(null));
      setSubcategory(null);
      setCategory(explorerCategory(params.get("category")));
      setAllEsimDestinations(params.get("allDestinations") === "1");
      setSearch("");
      setQuickSelection(null);
      setTag("all");
      setVisible(PAGE_SIZE);
    }
    window.addEventListener("popstate", restoreSelection);
    return () => window.removeEventListener("popstate", restoreSelection);
  }, []);

  function chooseCountry(code: string) {
    const next = explorerCountry(code)?.code ?? (country || "ng");
    setAllEsimDestinations(false);
    setCountry(next);
    if (next !== country) setLiveRevision(0);
    setTag("all");
    setSearch("");
    setQuickSelection(null);
    setVisible(PAGE_SIZE);
    writeSelection(next, category);
  }

  function chooseCategory(next: ExplorerFilter) {
    setSubcategory(null);
    setCategory(next);
    setTag("all");
    setSearch("");
    setQuickSelection(null);
    setVisible(PAGE_SIZE);
    writeSelection(country, next);
  }

  function clearQuickSelection() {
    setQuickSelection(null);
    setSearch("");
    setVisible(PAGE_SIZE);
  }

  function chooseShortcut(key: string) {
    const option = quickChoices.find((choice) => choice.key === key);
    if (!option) return;
    if (quickSelection?.key === key) { clearQuickSelection(); return; }
    setQuickSelection({ ...option, catalogueSearch: quickSelection?.catalogueSearch ?? search });
    setSearch(option.label);
    // A previously selected type could otherwise hide the chosen app entirely.
    setTag("all");
    setVisible(PAGE_SIZE);
  }

  const rejectedNotice = rejectedCountry || rejectedCategory ? (
    <p role="status" className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-meta leading-relaxed text-amber-900">

      <span>
        That link asked for{rejectedCountry ? <> country <strong className="font-semibold">&ldquo;{truncate(rejectedCountry)}&rdquo;</strong></> : null}
        {rejectedCountry && rejectedCategory ? " and" : null}
        {rejectedCategory ? <> category <strong className="font-semibold">&ldquo;{truncate(rejectedCategory)}&rdquo;</strong></> : null},
        which isn&rsquo;t something we list, so the selection was reset instead of guessing. Check your selection.
      </span>
    </p>
  ) : null;
  if (!countryReady) return <div className="grid gap-4">{rejectedNotice}<p role="status" className="text-meta text-ink-2">Restoring your country selection…</p></div>;

  if (category === "data") return <div className="grid gap-5">
    {rejectedNotice}
    <div>
      <h1 className="text-[1.6rem] font-semibold text-ink">Mobile data &amp; airtime</h1>
      <p className="mt-2 text-meta text-ink-2">Browse current Nigerian data bundles by network, lowest published price first. Airtime listings are not connected yet. Purchases are not available from this catalogue yet.</p>
    </div>
    <button type="button" onClick={() => chooseCategory("all")} className="w-fit text-meta font-semibold text-lav-700 underline">Back to all services</button>
    {selectedReadiness && selectedReadiness.state !== "buy" && selectedReadiness.state !== "free" ? (
      <div role="note" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-meta text-ink-2">
        <span>{selectedReadiness.detail}</span>
        <Link href={`/dashboard/support#ask=${encodeURIComponent(`When will ${selectedReadiness.label} be available to order?`)}`} className="shrink-0 font-semibold text-lav-700 underline underline-offset-2">Ask about it</Link>
      </div>
    ) : null}
    <DataPlansForm />
  </div>;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-micro font-bold uppercase tracking-[0.16em] text-lav-700">Explore PryvaLogs</p>
          <h1 className="mt-1 text-[1.6rem] font-semibold leading-tight text-ink sm:text-[1.9rem]">{selectedCategory?.label ?? "Marketplace"}</h1>
          <p className="mt-1.5 max-w-2xl text-[0.8125rem] leading-relaxed text-ink-2">{selectedCategory ? `${selectedCategory.description}. Check each listing for availability and any location requirements.` : "Choose a service, then browse its offers. Location and checkout requirements vary by service."}</p>
        </div>
        <Link href="/dashboard/orders" className="inline-flex items-center gap-1 text-meta font-semibold text-lav-700 hover:underline">My orders </Link>
      </div>

      {rejectedNotice}

      <section aria-labelledby="categories-title" className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-micro font-bold uppercase tracking-[0.16em] text-lav-700">Step 01</p>
            <h2 id="categories-title" className="mt-1 text-[1rem] font-semibold text-ink">Choose a service</h2>
          </div>
          {selectedCountry && <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-meta font-semibold text-ink-2">
            {selectedCountry.name}
          </span>}
        </div>
        {summary ? <p className="mt-1.5 text-meta text-ink-3">{summary} Labels describe setup, not current stock. Check each listing for availability.</p> : null}
        <div className="mt-3 sm:mt-4">
          <label htmlFor="service-category" className="sr-only">Service category</label>
          <select
            id="service-category"
            value={category}
            onChange={(event) => chooseCategory(explorerCategory(event.target.value))}
            aria-describedby={selectedCategory ? "service-category-description" : undefined}
            className="min-h-11 w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-meta font-semibold text-ink focus:border-lav-400 focus:outline-none focus:ring-4 focus:ring-lav-100 sm:max-w-lg"
          >
            <option value="all">All categories</option>
            {SERVICE_CATEGORY_GROUPS.map((group) => (
              <optgroup key={group.id} label={group.label}>
                {orderedCategories.filter((entry) => group.categories.includes(entry.id)).map((entry) => {
                  const state = readinessById.get(entry.id);
                  return (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}{state ? ` · ${SERVICE_STATE_LABEL[state.state]}` : ""}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
          {selectedCategory && (
            <p id="service-category-description" className="mt-2 text-meta text-ink-3">{selectedCategory.description}</p>
          )}
        </div>
        {(category === "all" || category === "accounts") && <p className="mt-3 text-meta leading-relaxed text-ink-2">
          Looking for paid email or social accounts? <Link href="/dashboard/accounts" className="font-semibold text-lav-700 underline underline-offset-2">Browse account listings</Link> without choosing a country. {category === "all" && <>For a free disposable address, <Link href="/dashboard/inbox" className="font-semibold text-lav-700 underline underline-offset-2">open the temporary inbox</Link>.</>}
        </p>}
        {selectedReadiness && selectedReadiness.state !== "buy" && selectedReadiness.state !== "free" ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-line bg-white px-3.5 py-2.5 text-meta text-ink-2">
            <span className="min-w-0 flex-1">
              <strong className="font-semibold text-ink">{SERVICE_STATE_LABEL[selectedReadiness.state]}.</strong>{" "}
              {selectedReadiness.detail}
            </span>
            <Link
              href={`/dashboard/support#ask=${encodeURIComponent(`When will ${selectedReadiness.label} be available to order?`)}`}
              className="shrink-0 font-semibold text-lav-700 underline underline-offset-2"
            >
              Ask about it
            </Link>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="choose-country-title" className="rounded-[1.5rem] border border-lav-200/80 bg-[#f6f1fc] p-4 sm:p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_1.1fr] md:items-center md:gap-4">
          <div>
            <p className="inline-flex items-center gap-1.5 text-micro font-bold uppercase tracking-[0.16em] text-lav-700">Step 02</p>
            <h2 id="choose-country-title" className="mt-1 text-[1rem] font-semibold text-ink">Country for relevant offers</h2>
            <p className="mt-1.5 max-w-sm text-meta leading-relaxed text-ink-2">Some services aren’t country-specific. Change your selection any time; it is remembered on this device when browser storage is available.</p>
          </div>
          <div className="rounded-xl border border-white/80 bg-white/60 p-3">
            <CountrySelector id="service-country" value={country} onChange={chooseCountry} />
          </div>
        </div>
      </section>

      {!selectedCountry ? (
        <div className="rounded-[1.5rem] border border-dashed border-lav-200 bg-white/70 px-4 py-8 text-center sm:px-6 sm:py-10">

          <h2 className="mt-3 text-[1rem] font-semibold text-ink">Choose a country to explore</h2>
          <p className="mx-auto mt-1.5 max-w-md text-[0.8125rem] leading-relaxed text-ink-2">We&apos;ll show service categories and available listings after you make your selection.</p>
          <div className="mx-auto mt-5 grid max-w-xl grid-cols-2 gap-2 sm:mt-6 sm:grid-cols-3 sm:gap-3">
            {POPULAR_COUNTRIES.map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => chooseCountry(c.code)}
                className="flex flex-col items-center justify-center rounded-2xl border border-line bg-white p-3 transition-all hover:-translate-y-0.5 hover:border-lav-300 hover:shadow-xs sm:p-3.5"
              >
                <span className="mt-2 text-[0.875rem] font-semibold text-ink">{c.name}</span>
                <span className="mt-0.5 text-micro text-ink-3">{c.desc}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>


          <div role="note" className={`flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-meta leading-relaxed border-amber-200 bg-amber-50/70 text-amber-900`}>

            {verificationPending || numberAppsPending || liveState?.loading ? <p><strong>Checking live availability.</strong> Results will appear as soon as the catalogue responds.</p>
              : numberAppsUnconfirmed && !liveState?.reason ? <p><strong>App availability is not confirmed.</strong> General plans and rentals can still be browsed below. <Link href="/dashboard/orders" className="font-semibold underline underline-offset-2">View existing orders</Link>.</p>
              : liveState?.country === country && liveState.live && liveState.reason !== "funding" && !liveState.partial && !liveState.failed && !numberAppsUnconfirmed ? <p><strong>Live listings loaded.</strong> Available listings, catalog plans and tools are labelled separately. Prices and coverage can change. <Link href="/dashboard/esim" className="font-semibold underline underline-offset-2">Check current eSIM plans</Link> or <Link href="/dashboard/orders" className="font-semibold underline underline-offset-2">view existing orders</Link>.</p> : <p><strong>{liveUnavailableCopy(liveState?.country === country ? liveState.reason : null).lead}</strong>{" "}{liveUnavailableCopy(liveState?.country === country ? liveState.reason : null).rest} <Link href="/dashboard/orders" className="font-semibold underline underline-offset-2">View existing orders</Link>.</p>}
          </div>

          <section aria-labelledby="services-title" aria-busy={verificationPending || numberAppsPending || undefined} className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-3.5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="inline-flex items-center gap-1.5 text-micro font-bold uppercase tracking-[0.16em] text-lav-700">Step 03</p>
                <h2 id="services-title" className="mt-1 text-[1rem] font-semibold text-ink">{selectedCategory ? `Explore ${selectedCategory.label}` : "Explore services"}</h2>
                <p aria-live="polite" className="mt-1 text-meta text-ink-3">
                  {verificationPending && filtered.length === 0 ? "Loading app verification listings…"
                    : verificationUnavailable && filtered.length === 0 ? "App verification listings are unavailable right now"
                    : category === "numbers" ? <>{filtered.length} general plan or rental {`listing${filtered.length === 1 ? "" : "s"}`}</>
                    : <>{filtered.length} {`listing${filtered.length === 1 ? "" : "s"}`}{verificationPending ? " so far" : ""}</>}
                  {" · "}{selectedCountry.name} selected
                </p>
                {liveState?.country === country && liveState.fetchedAt && <p className="mt-1 text-micro text-ink-3">Catalogue checked: <time dateTime={liveState.fetchedAt}>{new Date(liveState.fetchedAt).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}</time></p>}
              </div>
              <div className="relative w-full sm:max-w-[260px]">

                <input type="search" value={search} onChange={(event) => { setQuickSelection(null); setSearch(event.target.value); setVisible(PAGE_SIZE); }} aria-label="Search services" placeholder="Search services or platforms" className="min-h-11 w-full rounded-xl border border-line bg-white py-2 px-3 text-meta text-ink outline-none placeholder:text-ink-3 focus:border-lav-400 focus:ring-4 focus:ring-lav-100" />
              </div>
            </div>

            {category === "email" && <div role="note" className="mt-4 rounded-xl border border-lav-200 bg-lav-50/60 p-3 text-meta leading-relaxed text-ink-2">
              <p><strong className="text-ink">Looking to buy an email account?</strong> Temporary inbox and email verification services are separate from paid accounts. Browse paid email accounts, including Gmail and others when listed, in Social &amp; Digital Accounts. Availability and checkout depend on the listing.</p>
              <Link href="/dashboard/accounts" className="mt-2 inline-block font-semibold text-lav-700 underline underline-offset-2">Browse email accounts</Link>
            </div>}

            <QuickShortcuts
              key={`${country}:${category}:${subcategory?.id ?? ""}`}
              label="Quick app and product shortcuts"
              title={category === "numbers" || category === "verification" ? "Find an app:" : category === "social" ? "Find a platform:" : category === "email" ? "Find an app or provider:" : "Find an app or product:"}
              description="These shortcuts filter loaded listings, which may be incomplete or out of date. Check stock, region and checkout on each offer."
              options={quickChoices}
              selected={quickSelection?.key ?? null}
              onSelect={chooseShortcut}
              onClear={clearQuickSelection}
            />

            {(category === "numbers" || category === "verification") && <div role="note" className="mt-3 rounded-xl border border-lav-200 bg-lav-50/60 p-3 text-meta leading-relaxed text-ink-2">
              <p><strong className="text-ink">Not sure which category?</strong> Number plans includes app-specific single-use offers alongside general plans and rentals for {selectedCountry.name}. App verification focuses on those same app-specific offers. Availability and checkout depend on each offer and country.</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                <button type="button" onClick={() => chooseCategory("numbers")} className="font-semibold text-lav-700 underline">Browse number plans</button>
                <button type="button" onClick={() => chooseCategory("verification")} className="font-semibold text-lav-700 underline">Browse app-specific SMS</button>
              </div>
            </div>}
            {enableDigitalCatalogue && <label className="mt-3 flex items-center gap-2 text-meta text-ink-2"><input type="checkbox" checked={stockOnly} onChange={(event) => { setStockOnly(event.target.checked); setVisible(PAGE_SIZE); }} />Show catalogue listings with reported stock only</label>}
            {enableDigitalCatalogue && category === "subscriptions" && <p className="mt-2 text-meta text-ink-2">Browse subscription product types below or search by product name. {stockOnly ? "Out-of-stock and unknown-stock listings are hidden; clear the stock filter to include them." : "All reported availability states are included; ordering is checked separately."} Use load more to browse remaining catalogue pages.</p>}
            {enableDigitalCatalogue && <DigitalCategoryPicker key={category} category={category} onSelect={(entry) => { setSubcategory(entry); if (quickSelection) clearQuickSelection(); setVisible(PAGE_SIZE); }} />}
            {category === "esim" && <label className="mt-3 flex items-center gap-2 text-meta text-ink-2"><input type="checkbox" checked={allEsimDestinations} onChange={(event) => { setAllEsimDestinations(event.target.checked); setVisible(PAGE_SIZE); }} />Browse all destinations</label>}
            {enableDigitalCatalogue && <div className="mt-3 text-meta text-ink-3" aria-live="polite">
              <p>Search filters the listings loaded in this category; load more pages to see further matches.</p>
              <p>Offers are grouped by service, across catalogues. Check each offer’s region and terms before buying; digital catalogue coverage is unconfirmed.</p>
              {digital.loading && <p>Loading more service offers…</p>}
              {digital.error && <p>
                {digital.reason === "environment" ? "The digital catalogue is unavailable in this environment."
                  : digital.reason === "unconfigured" ? "Digital catalogue is not connected yet."
                  : digital.reason === "sign-in" ? <>Your session has expired. <Link href="/login?next=%2Fdashboard%2Fservices" className="font-semibold underline">Sign in again</Link> to load digital listings.</>
                  : digital.reason === "throttled" ? "Digital listings were requested too quickly. Wait a little before trying again."
                  : "Some listings could not be loaded from the digital catalogue."}{" "}
                {digital.retryBlocked && (digital.reason === "error" || digital.reason === "throttled") && "Please wait for the cooldown to finish. "}
                {(digital.reason === "error" || digital.reason === "throttled") && <button type="button" onClick={digital.retry} disabled={digital.loading || digital.loadingMore || digital.retryBlocked} className="font-semibold underline disabled:opacity-50">Retry catalogue</button>}
              </p>}
              {digital.limited && <p>Search results are limited. Browse category pages for more offers.</p>}
              {digital.hasMore && <button type="button" disabled={digital.pageLoading || digital.loadingMore || digital.retryBlocked} onClick={digital.loadMore} className="mt-2 rounded-lg border border-line px-3 py-2 font-semibold disabled:opacity-50">{digital.loadingMore ? "Loading…" : "Load more digital listings"}</button>}
            </div>}

            {tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-4" role="group" aria-label="Service types">
                <button type="button" onClick={() => { setTag("all"); setVisible(PAGE_SIZE); }} aria-pressed={tag === "all"} className={`rounded-lg px-2.5 py-1.5 text-micro font-semibold ${tag === "all" ? "bg-lav-100 text-lav-800" : "text-ink-3 hover:bg-cream"}`}>All types</button>
                {tags.map((type) => <button key={type} type="button" onClick={() => { if (category === "numbers" && quickSelection && type !== "Single use") clearQuickSelection(); setTag(type); setVisible(PAGE_SIZE); }} aria-pressed={tag === type} className={`rounded-lg px-2.5 py-1.5 text-micro font-semibold ${tag === type ? "bg-lav-100 text-lav-800" : "text-ink-3 hover:bg-cream"}`}>{type}</button>)}
              </div>
            )}

            {category === "numbers" && (tag === "all" || tag === "Single use") && <NumberAppOffers
              key={`${country}:${quickSelection?.key ?? ""}`}
              countryName={selectedCountry.name}
              countryCode={selectedCountry.code}
              feed={appFeed}
              pending={numberAppsPending}
              search={search}
              shortcutKey={quickSelection?.key ?? null}
              retryBlocked={liveState?.verificationRetryBlocked ?? false}
              onRetry={() => setLiveRevision((value) => value + 1)}
            />}

            {liveState?.loading && <p role="status" className="mt-3 text-meta text-ink-3">Live listings are still loading. Available feeds are shown as they arrive.</p>}
            {liveState?.country === country && (liveState.reason === "funding" || liveState.reason === "throttled" || liveState.reason === "error" || liveState.reason === "sign-in") && (
              <p role="status" className="mt-4 text-meta text-amber-800">
                {liveState.reason === "sign-in" ? <>Your session has expired. <Link href="/login?next=%2Fdashboard%2Fservices" className="font-semibold underline">Sign in again</Link>.</>
                  : liveState.reason === "throttled" ? "Live listings were refreshed too quickly."
                  : liveState.reason === "funding" ? "Live listings are paused while we restock." : "Some live listings could not be loaded."}{" "}
                {liveState.reason === "error" && liveState.affectedFeeds.length > 0 && <span>Affected: {liveState.affectedFeeds.join(", ")}. </span>}
                {/* No Retry on a funding gap or signed-out session. */}
                {liveState.retryBlocked && (liveState.reason === "error" || liveState.reason === "throttled") && "Please wait before retrying. "}
                {(liveState.reason === "error" || liveState.reason === "throttled") && <button type="button" className="font-semibold underline disabled:opacity-50" disabled={!liveState.canRetry} onClick={() => setLiveRevision((value) => value + 1)}>Retry</button>}
              </p>
            )}
            {category === "numbers" && <h3 className="mt-5 text-[0.9375rem] font-semibold text-ink">General plans &amp; rentals</h3>}
            {platformGroups ? (
              <div className="mt-3 grid gap-2.5 sm:mt-4 sm:gap-3">
                {platformGroups.map((group, index) => {
                  // Browsing opens the first platform only; the rest stay as
                  // headers so 300 offers do not arrive as 300 cards at once.
                  const open = filtering || (platformOpen[group.platform] ?? index === 0);
                  const limit = groupVisible[group.platform] ?? PAGE_SIZE;
                  // The panel is only mounted while open, so aria-controls is
                  // omitted when collapsed rather than naming a missing element.
                  const panelId = `platform-panel-${index}`;
                  return (
                    <section key={group.platform} className="overflow-hidden rounded-2xl border border-line bg-white">
                      <h3 className="m-0">
                        <button
                          type="button"
                          onClick={() => setPlatformOpen((current) => ({ ...current, [group.platform]: !open }))}
                          aria-expanded={open}
                          aria-controls={open ? panelId : undefined}
                          className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-cream/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-lav-400"
                        >
                          <span className="min-w-0 flex-1 break-words text-[0.9375rem] font-semibold text-ink">{group.platform}</span>
                          <span className="shrink-0 rounded-full bg-cream px-2 py-0.5 text-micro font-semibold text-ink-2">
                            {group.items.length} {group.items.length === 1 ? "listing" : "listings"}
                          </span>
                          <span className="shrink-0 text-micro font-semibold text-lav-700">{open ? "Hide" : "Show"}</span>
                        </button>
                      </h3>
                      {open && (
                        <div id={panelId} className="border-t border-line p-2.5 sm:p-3">
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-3">
                            {group.items.slice(0, limit).map((item) => <ServiceCard key={item.id} item={item} countryName={selectedCountry.name} />)}
                          </div>
                          {limit < group.items.length && (
                            <div className="mt-3 text-center">
                              <button
                                type="button"
                                onClick={() => setGroupVisible((current) => ({ ...current, [group.platform]: limit + PAGE_SIZE }))}
                                className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3.5 py-2 text-micro font-semibold text-ink-2 transition-colors hover:border-lav-300 hover:text-lav-700"
                              >
                                More {group.platform} <span className="text-ink-3">({group.items.length - limit} remaining)</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-2 sm:mt-4 sm:grid-cols-2 sm:gap-3 xl:grid-cols-3">
                {filtered.slice(0, visible).map((item) => <ServiceCard key={item.id} item={item} countryName={selectedCountry.name} />)}
              </div>
            )}
            {filtered.length === 0 && !verificationPending && (!verificationUnavailable || filtering) && (
              <div className="rounded-2xl border border-dashed border-line bg-cream/50 p-8 text-center">
                <p className="text-[0.875rem] font-semibold text-ink">
                  {verificationUnavailable ? "Matches cannot be confirmed while listings are unavailable"
                    : category === "verification" && !filtering ? `No app verification listings were reported for ${selectedCountry.name}`
                    : category === "numbers" ? "No general plans or rentals match these filters"
                    : "No listings match these filters"}
                </p>
                <p className="mt-1 text-meta text-ink-2">{category === "verification" && !filtering
                  ? "Try another country or check back later. Availability can change."
                  : "Try another search, category or country. This doesn't indicate live availability."}</p>
                {category === "subscriptions" && !search && !digital.loading && <p className="mt-3 text-meta text-ink-2">No subscription listings have loaded for this selection. Try loading more catalogue pages or <Link href="/dashboard/support" className="font-semibold text-lav-700 underline">Ask about subscriptions</Link>. Availability depends on each product.</p>}
                {(search || tag !== "all") && <button type="button" onClick={() => { clearQuickSelection(); setTag("all"); }} className="mt-3 text-meta font-semibold text-lav-700 underline underline-offset-2">Clear filters</button>}
              </div>
            )}
            {!platformGroups && visible < filtered.length && (
              <div className="mt-5 text-center">
                <button type="button" onClick={() => setVisible((current) => current + PAGE_SIZE)} className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2.5 text-meta font-semibold text-ink-2 transition-colors hover:border-lav-300 hover:text-lav-700">Show more <span className="text-ink-3">({filtered.length - visible} remaining)</span></button>
              </div>
            )}
            <p className="mt-5 border-t border-line pt-4 text-micro leading-relaxed text-ink-3">Stock means available inventory. My units means your remaining purchased units. Unknown and not tracked are not the same as zero. Listings do not guarantee platform support or verified coverage.</p>
          </section>
        </>
      )}
    </div>
  );
}
