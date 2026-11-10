"use client";

import { DigitalProductIcon } from "@/components/DigitalProductIcon";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { BrandIcon } from "@/components/BrandIcon";
import { CountryFlag } from "@/components/CountryFlag";
import { CountrySelector } from "@/components/dashboard/CountrySelector";
import { NetworkBadge } from "@/components/NetworkBadge";
import { ServiceIcon } from "@/components/ServiceIcon";
import { DigitalCategoryPicker } from "@/components/dashboard/DigitalCategoryPicker";
import { useDigitalExplorer } from "@/components/dashboard/useDigitalExplorer";
import { UnitsStatus } from "@/components/dashboard/UnitsStatus";
import { ArrowRight, ChevronDown, Globe, Lock, MailQuestion, Search, Shield, Sparkle } from "@/components/icons";
import { formatNaira } from "@/lib/services/catalog";
import { formatUnitCount } from "@/lib/services/service-units";
import {
  orderByReadiness,
  readinessSummary,
  SERVICE_STATE_DOT,
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
  games: "🎮",
  topups: "💳",
  "gift-cards": "🎁",
  prepaid: "💳",
  tools: "⚙️",
};

const POPULAR_COUNTRIES = [
  { code: "ng", name: "Nigeria", desc: "Local numbers & data" },
  { code: "us", name: "United States", desc: "US numbers & proxies" },
  { code: "gb", name: "United Kingdom", desc: "UK verification numbers" },
  { code: "ca", name: "Canada", desc: "Canadian plans" },
  { code: "gh", name: "Ghana", desc: "Regional African plans" },
];

/**
 * The fallback for an inbox whose provider is not recognised.
 *
 * Always decorative: the card beside it carries the listing's own name, so an
 * `aria-label` here would read that name twice.
 */
function UnidentifiedInbox({ size }: { size: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-lg bg-lav-100 text-lav-700"
      style={{ width: size, height: size }}
    >
      <MailQuestion width={Math.round(size * 0.55)} height={Math.round(size * 0.55)} />
    </span>
  );
}

function SiteFavicon({ domain, size, verification = false }: { domain: string; size: number; verification?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return verification ? <ServiceIcon service="numbers" size={size <= 28 ? "sm" : "md"} /> : <UnidentifiedInbox size={size} />;

  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line/70 bg-white"
      style={{ width: size, height: size }}
    >
      {/* The supplier lists destination sites as well as mail providers. The
          favicon service may have no icon or return a generic placeholder, so
          requesting a favicon alone does not verify the site's artwork. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-full w-full object-contain p-1"
      />
    </span>
  );
}

/** Static, version-pinned upstream SVGs. The slug and colour come only from
 * our generated allowlist, never from a supplier URL or free-form label. */
function SimpleIcon({ slug, hex, version, size }: { slug: string; hex: string; version: string; size: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <ServiceIcon service="numbers" size={size <= 28 ? "sm" : "md"} />;
  return <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line/70 bg-white" style={{ width: size, height: size }}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={`https://cdn.jsdelivr.net/npm/simple-icons@${version}/icons/${slug}.svg`} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-contain p-2" style={{ backgroundColor: `#${hex}10` }} />
  </span>;
}

/** A bundled, reviewed brand mark. Slugs come from the server's allowlist. */
function VerifiedBrandLogo({ slug, size, format }: { slug: string; size: number; format?: "png" }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <ServiceIcon service="numbers" size={size <= 28 ? "sm" : "md"} />;
  return (
    <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line/70 bg-white" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/verification-logos/${encodeURIComponent(slug)}.${format === "png" ? "png" : "svg"}`} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setFailed(true)} className="h-full w-full object-contain p-1" />
    </span>
  );
}

function itemArt(item: ExplorerItem, size: "sm" | "md" = "md") {
  const pixels = size === "sm" ? 28 : 42;
  switch (item.artwork.kind) {
    case "digital-product": return <DigitalProductIcon key={item.id} name={item.name} artwork={item.artwork.art} size={pixels} />;
    case "brand": return <BrandIcon brand={item.artwork.name} size={pixels} decorative />;
    case "network": return <NetworkBadge provider={item.artwork.name} size={pixels} />;
    case "service": return <ServiceIcon service={item.artwork.name} size={size} />;
    case "site-favicon": return <SiteFavicon key={item.artwork.domain} domain={item.artwork.domain} size={pixels} verification={item.category === "verification"} />;
    case "simple-icon": return <SimpleIcon key={item.artwork.slug} {...item.artwork} size={pixels} />;
    case "verified-brand-logo": return <VerifiedBrandLogo key={`${item.artwork.slug}:${item.artwork.format ?? "svg"}`} slug={item.artwork.slug} format={item.artwork.format} size={pixels} />;
    // A mailbox with no published favicon: Lucide's `mail-question`, never
    // another provider's logo or the Temporary-inbox tool's mark.
    case "unidentified-inbox": return <UnidentifiedInbox size={pixels} />;
  }
}

export function ServiceCard({ item, countryName }: { item: ExplorerItem; countryName: string }) {
  const coverage = item.source === "live"
      ? (item.coverage === "catalog-country" ? `Reported region: ${countryName}` : item.coverage === "unconfirmed" ? "Country coverage unconfirmed" : "Not country-specific")
      : item.coverage === "catalog-country" ? `Catalog region: ${countryName}` : item.coverage === "unconfirmed" ? "Country coverage unconfirmed" : "Not filtered by country";
  const noAction = item.orderingPaused ? "Ordering paused" : item.category === "verification" && item.source === "live"
    ? "Not available to order"
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
      ? "Ordering unavailable"
      : (item.category === "esim" || item.category === "social") && item.source === "live" ? "Price unavailable" : "See details";

  /*
   * One card, two densities. On a phone this is a 68 px row: artwork, name,
   * one compact line with the type and price, and a single 44 px action. From
   * `sm` up it opens into the full card (badge, description, coverage, price
   * line, stock and units, labelled button).
   *
   * The alternative — a separate mobile card — would duplicate every heading
   * and action in the DOM, so screen readers and the tests that count cards
   * would see each service twice. Same markup, responsive classes only.
   */
  return (
    <article className="group flex min-w-0 items-center gap-2.5 rounded-xl border border-line bg-white p-2.5 shadow-xs transition-all duration-200 hover:border-lav-300 sm:h-full sm:flex-col sm:items-stretch sm:gap-0 sm:rounded-2xl sm:p-4 sm:hover:-translate-y-0.5 sm:hover:shadow-md">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-lav-50/70 sm:rounded-xl">{itemArt(item)}</div>
      <div className="min-w-0 flex-1 sm:mt-3">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <h3 className="min-w-0 truncate text-[0.875rem] font-semibold leading-snug text-ink sm:whitespace-normal sm:break-words sm:text-[0.9375rem]">{item.name}</h3>
          <span className={`hidden shrink-0 rounded-full px-2.5 py-1 text-micro font-bold uppercase tracking-[0.08em] sm:inline-flex ${sourceTone}`}>
            {sourceLabel}
          </span>
        </div>
        {/* Phones keep only what the choice needs: type and price, on one line. */}
        <p className="mt-0.5 truncate text-micro text-ink-3 sm:hidden">
          <span className="capitalize">{item.tag}</span>
          {/* Deliberately not the desktop wording: two visible-in-one-breakpoint
              copies of the same sentence would be read out twice, and the tests
              that look up the full price line would match both. */}
          {price !== null ? ` · ${formatNaira(price)}${item.priceFrom ? "+" : ""}` : item.category === "verification" && item.source === "live" ? " · Ordering unavailable" : (item.category === "esim" || item.category === "social") && item.source === "live" ? " · Price unavailable" : item.source === "live" ? " · Price on request" : " · Price not listed"}
        </p>
        {/* OTP stock comes from the selected pool. Keep it visible
            on phones too; hiding UnitsStatus at the mobile breakpoint made a
            live listing look empty even when the supplier reported inventory. */}
        {item.category === "verification" && item.source === "live" && (
          <p className="mt-0.5 truncate text-micro text-ink-3 sm:hidden">
            <span className="font-semibold">Reported stock:</span> {formatUnitCount(item.stock, "Not reported")}
          </p>
        )}
        {/* Number-plan counts, when reported, must be visible on phones too.
            A static plan has no independent inventory; null remains unknown. */}
        {item.category === "numbers" && (
          <p className="mt-0.5 truncate text-micro text-ink-3 sm:hidden">
            <span className="font-semibold">Stock:</span> {formatUnitCount(item.stock, "Not reported")}
          </p>
        )}
        {/* Variants of one product differ by refill and order bounds, so a phone
            needs that line as much as a desktop does. */}
        {item.detail && <p className="mt-0.5 truncate text-micro text-ink-3 sm:hidden">{item.detail}</p>}
        <p className="mt-1 hidden text-meta text-ink-3 sm:block">{item.description} · <span className="capitalize">{item.tag}</span></p>
        <p className="mt-3 hidden text-micro leading-relaxed text-ink-3 sm:block">{item.detail ?? coverage}</p>
      </div>
      <div className="shrink-0 sm:mt-auto sm:w-full sm:pt-3">
        <p className="hidden min-h-[1.2rem] text-meta font-semibold text-ink sm:block">{priceLine}</p>
        <div className="hidden sm:mt-2 sm:block"><UnitsStatus stock={item.stock} owned={item.myUnits} /></div>
        {action ? (
          <Link
            href={action.href}
            aria-label={action.label}
            className="grid h-11 w-11 place-items-center rounded-xl border border-lav-200 bg-lav-50 text-lav-800 transition-colors hover:border-lav-400 hover:bg-lav-100 sm:mt-3 sm:flex sm:h-auto sm:min-h-10 sm:w-full sm:justify-center sm:gap-1.5 sm:px-3 sm:py-2 sm:text-center sm:text-meta sm:font-semibold"
          >
            <span className="hidden sm:inline">{action.label}</span>
            <ArrowRight className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
          </Link>
        ) : (
          <button
            type="button"
            disabled
            aria-label={noAction}
            title={noAction}
            className="grid h-11 w-11 place-items-center rounded-xl border border-line bg-cream/60 text-ink-3/80 disabled:cursor-not-allowed sm:mt-3 sm:flex sm:h-auto sm:min-h-10 sm:w-full sm:justify-center sm:px-3 sm:py-2 sm:text-meta sm:font-semibold"
          >
            <span className="hidden sm:inline">{noAction}</span>
            <Lock className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </article>
  );
}

/** Keep country and category shareable, and allow Back to restore the choice. */
function writeSelection(country: string, category: ExplorerFilter, allEsimDestinations = false) {
  const params = new URLSearchParams();
  if (country) params.set("country", country);
  if (category !== "all") params.set("category", category);
  if (category === "esim" && allEsimDestinations) params.set("allDestinations", "1");
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ""}`;
  if (next !== `${window.location.pathname}${window.location.search}`) window.history.pushState(null, "", next);
}

/**
 * What the live catalogue request did, in the customer's terms.
 *
 * The three "not live" cases are deliberately distinct: an environment with
 * live listings switched off and a deployment with no supplier connected are
 * both steady states, so they must not read as breakage or offer a Retry that
 * cannot change the answer. Only `error` and `throttled` are worth retrying.
 */
type LiveState = {
  country: string;
  items: ExplorerItem[];
  live: boolean;
  partial: boolean;
  failed: boolean;
  reason: "environment" | "unconfigured" | "funding" | "throttled" | "error" | null;
  fetchedAt: string | null;
  scope: string;
  pending: boolean;
  truncated: boolean;
  unreadable: boolean;
};

type FeedOutcome = { items: ExplorerItem[]; live: boolean; partial: boolean; reason: LiveState["reason"]; fetchedAt: string | null; truncated?: boolean; unreadable?: boolean };
type CatalogPayload = {
  ok?: boolean; country?: string; live?: boolean; partial?: boolean; truncated?: boolean; unreadable?: boolean;
  reason?: string | null; fetchedAt?: string | null; items?: ExplorerItem[];
};

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
  if (reason === "funding") return {
    // Out of stock at the source, not out of order. Nothing here is the
    // customer's to fix, and no amount of retrying restocks it.
    lead: "Live listings are paused while we restock.",
    rest: "Nothing is wrong with your account or your orders; check back soon.",
  };
  if (reason === "error") return {
    lead: "Live listings are refreshing.",
    rest: "Browse the catalogue below while the live feed syncs again.",
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
    const stored = window.localStorage.getItem(SERVICE_COUNTRY_STORAGE_KEY);
    const remembered = explorerCountry(stored)?.code;
    if (remembered) return remembered;
  }
  return "ng";
}

export function ServiceExplorer({
  initialCountry,
  initialCategory,
  initialAllEsimDestinations = false,
  rejectedCountry = null,
  rejectedCategory = null,
  readiness = [],
  enableDigitalCatalogue = false,
  reviewedItems = [],
  giftCardManager,
}: {
  initialCountry: string | null;
  initialCategory: string | null;
  initialAllEsimDestinations?: boolean;
  /** Link values the server could not honour, echoed so the reset is visible. */
  rejectedCountry?: string | null;
  rejectedCategory?: string | null;
  /**
   * What each category can actually do, computed by the server from the same
   * configuration the checkout reads. Absent in unit tests, where the hub still
   * renders — just without the labels.
   */
  readiness?: ServiceReadinessEntry[];
  enableDigitalCatalogue?: boolean;
  reviewedItems?: ExplorerItem[];
  giftCardManager?: ReactNode;
}) {
  const [country, setCountry] = useState(() => resolveExplorerCountry(initialCountry));
  const [category, setCategory] = useState<ExplorerFilter>(() => explorerCategory(initialCategory));
  const [allEsimDestinations, setAllEsimDestinations] = useState(initialAllEsimDestinations);
  const [search, setSearch] = useState("");
  const [digitalStockOnly, setDigitalStockOnly] = useState(true);
  const [pickerRevision, setPickerRevision] = useState(0);
  const [digitalBrowse, setDigitalBrowse] = useState<{ category: ExplorerFilter; entry: { id: string; name: string; root?: string } } | null>(null);
  const [tag, setTag] = useState("all");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [platformOpen, setPlatformOpen] = useState<Record<string, boolean>>({});
  const [groupVisible, setGroupVisible] = useState<Record<string, number>>({});
  const [liveState, setLiveState] = useState<LiveState | null>(null);
  const [liveRevision, setLiveRevision] = useState(0);
  // A short, component-local cache avoids spending four rate-limit slots again
  // when a customer switches from All to a category. Never shared across users.
  const liveCache = useRef(new Map<string, { at: number; revision: number; value: FeedOutcome }>());
  const selectedCountry = explorerCountry(country);
  const feedScope = category === "all" ? "all" : category === "email" ? "numbers" : category === "esim" && allEsimDestinations ? "esim-all" : category;
  const currentLive = liveState?.country === country && liveState.scope === feedScope ? liveState : null;
  const selectedCategory = EXPLORER_CATEGORIES.find((entry) => entry.id === category);
  const digital = useDigitalExplorer(enableDigitalCatalogue, category, search, digitalStockOnly, digitalBrowse?.category === category ? digitalBrowse.entry : null);
  const items = useMemo(() => {
    const base = buildServiceExplorer(country);
    // A reviewed item may also appear in the live browse feed. Prefer the
    // browse record (including its stock status) without losing curated offers
    // that have not yet appeared on a loaded page.
    const browsedIds = new Set(digital.items.map((item) => item.id));
    return mergeExplorerSources([currentLive?.items ?? [], digital.items, reviewedItems.filter((item) => !browsedIds.has(item.id)), base]);
  }, [country, currentLive, digital.items, reviewedItems]);
  const filtered = useMemo(() => filterExplorerItems(items, category, search, tag), [items, category, search, tag]);
  /**
   * Social promotion lists every offer the supplier sells, which is hundreds
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

  // Fetch independent live feeds separately so one slow feed cannot hide the
  // others. Browsing one category contacts only its relevant live feed.
  useEffect(() => {
    if (!country) return;
    const controller = new AbortController();
    const all = ["numbers", "verification", "esim", "social"];
    const feeds = feedScope === "all" ? all : feedScope === "esim-all" ? ["esim"] : all.includes(feedScope) ? [feedScope] : [];
    const results = new Map<string, FeedOutcome>();
    const publish = () => {
      if (controller.signal.aborted) return;
      const complete = [...results.values()];
      const successes = complete.filter((result) => result.live);
      const failures = complete.filter((result) => result.reason === "error" || result.reason === "throttled");
      const funded = complete.filter((result) => result.reason === "funding");
      const waiting = complete.length < feeds.length;
      const partial = waiting || failures.length > 0 || funded.length > 0 || complete.some((result) => result.partial)
        || (successes.length > 0 && complete.some((result) => result.reason === "unconfigured" || result.reason === "environment"));
      const reason: LiveState["reason"] = failures.some((result) => result.reason === "throttled") ? "throttled"
        : failures.length ? "error"
        : funded.length ? "funding"
        : complete.length && complete.every((result) => result.reason === "environment") ? "environment"
        : complete.length && complete.every((result) => result.reason === "unconfigured") ? "unconfigured" : null;
      const fetchedAt = complete.map((result) => result.fetchedAt).filter((value): value is string => value !== null).sort().pop() ?? null;
      setLiveState({ country, scope: feedScope, items: complete.flatMap((result) => result.items),
        live: successes.length > 0, partial, failed: failures.length > 0 && successes.length === 0,
        reason, fetchedAt, pending: waiting, truncated: complete.some((result) => result.truncated), unreadable: complete.some((result) => result.unreadable) });
    };
    for (const feed of feeds) {
      const key = `${country}:${feedScope === "esim-all" ? "esim-all" : feed}`;
      const cached = liveCache.current.get(key);
      if (cached && cached.revision === liveRevision && Date.now() - cached.at < 30_000) {
        results.set(feed, cached.value);
        continue;
      }
      fetch(`/api/services/catalog?country=${encodeURIComponent(country)}&feed=${feed}${feedScope === "esim-all" ? "&allDestinations=1" : ""}${liveRevision ? "&refresh=1" : ""}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const data = (await response.json().catch(() => null)) as CatalogPayload | null;
          if (controller.signal.aborted) return;
          if (!response.ok || !data?.ok || data.country !== country || !Array.isArray(data.items)) {
            results.set(feed, { items: [], live: false, partial: true, reason: response.status === 429 ? "throttled" : "error", fetchedAt: null });
          } else {
            const reason = data.reason === "environment" || data.reason === "unconfigured" || data.reason === "funding" ? data.reason : null;
            const fetchedAt = typeof data.fetchedAt === "string" && Number.isFinite(Date.parse(data.fetchedAt)) ? data.fetchedAt : null;
            const value: FeedOutcome = { items: data.items, live: data.live !== false, partial: Boolean(data.partial), reason, fetchedAt, truncated: data.truncated === true, unreadable: data.unreadable === true };
            results.set(feed, value);
            // Do not hide an outage, funding gap or partial result behind cache.
            if (!value.partial && (value.live || reason === "unconfigured" || reason === "environment")) {
              liveCache.current.set(key, { at: Date.now(), revision: liveRevision, value });
            }
          }
          publish();
        }).catch(() => {
          if (controller.signal.aborted) return;
          results.set(feed, { items: [], live: false, partial: true, reason: "error", fetchedAt: null });
          publish();
        });
    }
    queueMicrotask(publish);
    return () => controller.abort();
  }, [country, feedScope, liveRevision]);

  useEffect(() => {
    if (typeof window !== "undefined" && country) {
      window.localStorage.setItem(SERVICE_COUNTRY_STORAGE_KEY, country);
    }
  }, [country]);

  // Handle browser back/forward when a history entry from another page is restored.
  useEffect(() => {
    function restoreSelection() {
      const params = new URLSearchParams(window.location.search);
      setCountry(explorerCountry(params.get("country"))?.code ?? resolveExplorerCountry(null));
      setCategory(explorerCategory(params.get("category")));
      setAllEsimDestinations(params.get("category") === "esim" && params.get("allDestinations") === "1");
      setDigitalBrowse(null);
      setPickerRevision((value) => value + 1);
      setSearch("");
      setTag("all");
      setVisible(PAGE_SIZE);
    }
    window.addEventListener("popstate", restoreSelection);
    return () => window.removeEventListener("popstate", restoreSelection);
  }, []);

  function chooseCountry(code: string) {
    const next = explorerCountry(code)?.code ?? (country || "ng");
    setCountry(next);
    if (next !== country) setLiveRevision(0);
    setTag("all");
    setSearch("");
    setVisible(PAGE_SIZE);
    writeSelection(next, category, allEsimDestinations);
  }

  function chooseCategory(next: ExplorerFilter) {
    if (next !== category) setDigitalBrowse(null);
    setCategory(next);
    setTag("all");
    setSearch("");
    setVisible(PAGE_SIZE);
    writeSelection(country, next, allEsimDestinations);
  }

  function chooseEsimScope(all: boolean) {
    setAllEsimDestinations(all);
    setVisible(PAGE_SIZE);
    writeSelection(country, "esim", all);
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-micro font-bold uppercase tracking-[0.16em] text-lav-700">Explore PryvaLogs</p>
          <h1 className="mt-1 text-[1.6rem] font-semibold leading-tight text-ink sm:text-[1.9rem]">{selectedCategory?.label ?? "Your service hub"}</h1>
          <p className="mt-1.5 max-w-2xl text-[0.8125rem] leading-relaxed text-ink-2">{selectedCategory ? `${selectedCategory.description}. Browse offers together by service; check each listing's coverage before ordering.` : "Pick a country once and browse services from available catalogues together by category."}</p>
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

      <section aria-labelledby="choose-country-title" className="relative overflow-hidden rounded-[1.5rem] border border-lav-200/80 bg-[#f6f1fc] p-4 sm:p-6">
        <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-20 h-48 w-48 rounded-full bg-lav-300/30 blur-3xl" />
        <div className="relative grid gap-3 md:grid-cols-[1fr_1.1fr] md:items-center md:gap-4">
          <div>
            <p className="inline-flex items-center gap-1.5 text-micro font-bold uppercase tracking-[0.16em] text-lav-700"><Globe className="h-3.5 w-3.5" /> Country</p>
            <h2 id="choose-country-title" className="mt-1.5 text-[1.125rem] font-semibold text-ink sm:mt-2 sm:text-[1.25rem]">Pick a country once.</h2>
            <p className="mt-1.5 max-w-sm text-meta leading-relaxed text-ink-2">Your selection stays saved for this service hub, so you do not need to rechoose it for every category or browse session.</p>
          </div>
          <div className="rounded-2xl border border-white/80 bg-white/60 p-3 shadow-sm sm:p-4">
            <CountrySelector id="service-country" value={country} onChange={chooseCountry} />
          </div>
        </div>
      </section>

      {!selectedCountry ? (
        <div className="rounded-[1.5rem] border border-dashed border-lav-200 bg-white/70 px-4 py-8 text-center sm:px-6 sm:py-10">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-lav-50 text-lav-700"><Globe className="h-5 w-5" /></span>
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
                <CountryFlag code={c.code} size={28} decorative />
                <span className="mt-2 text-[0.875rem] font-semibold text-ink">{c.name}</span>
                <span className="mt-0.5 text-micro text-ink-3">{c.desc}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <section aria-labelledby="categories-title" className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-micro font-bold uppercase tracking-[0.16em] text-lav-700">Step 02</p>
                <h2 id="categories-title" className="mt-1 text-[1rem] font-semibold text-ink">Choose a category</h2>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-meta font-semibold text-ink-2">
                <CountryFlag code={selectedCountry.code} size={18} decorative radius={9} /> {selectedCountry.name}
              </span>
            </div>
            {summary ? <p className="mt-1.5 text-meta text-ink-3">{summary}</p> : null}
            {/*
              `relative` is not decoration. The chips are a horizontal scroll
              strip on a phone, and each one carries an `sr-only` status label
              ("— Not connected") for screen readers. `sr-only` is
              `position: absolute`, so without a positioned ancestor it escapes
              the strip entirely and resolves against the page — where the
              strip has been scrolled it lands *past* the right edge of the
              viewport, at the unscrolled offset of a chip nobody can see. That
              made the document 1403px wide on a 390px phone, and a mobile
              browser that finds a page three times the screen width zooms out
              to fit it. This one class keeps every label inside the strip.
            */}
            <div className="relative -mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] sm:mt-4 sm:flex-wrap sm:gap-2 sm:overflow-visible sm:pb-0" aria-label="Service categories">
              <button type="button" onClick={() => chooseCategory("all")} aria-pressed={category === "all"} className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-meta font-semibold transition-colors sm:px-3.5 sm:py-2 ${category === "all" ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-2 hover:border-lav-300"}`}>
                <span aria-hidden="true">⚡</span> All categories
              </button>
              {orderedCategories.map((entry) => {
                const state = readinessById.get(entry.id);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    title={state ? `${entry.description} · ${SERVICE_STATE_LABEL[state.state]}` : entry.description}
                    onClick={() => chooseCategory(entry.id)}
                    aria-pressed={category === entry.id}
                    className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-meta font-semibold transition-colors sm:px-3.5 sm:py-2 ${category === entry.id ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-2 hover:border-lav-300"}`}
                  >
                    <span aria-hidden="true">{CATEGORY_ICONS[entry.id] ?? "✨"}</span> {entry.label}
                    {state ? (
                      <>
                        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${SERVICE_STATE_DOT[state.state]}`} />
                        <span className="sr-only">— {SERVICE_STATE_LABEL[state.state]}</span>
                      </>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {selectedReadiness && selectedReadiness.state !== "buy" && selectedReadiness.state !== "free" ? (
              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-line bg-white px-3.5 py-2.5 text-meta text-ink-2">
                <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${SERVICE_STATE_DOT[selectedReadiness.state]}`} />
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

          <div role="note" className={`flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-meta leading-relaxed border-amber-200 bg-amber-50/70 text-amber-900`}>
            <Shield className="mt-0.5 h-4 w-4 shrink-0" />
            {currentLive && currentLive.live && !currentLive.failed ? <p><strong>{currentLive.pending ? "Live listings are still loading." : currentLive.partial ? "Live listings may be incomplete or out of date." : "Live listings are current."}</strong> Offers are grouped by service, and prices and coverage can change. Check each listing before ordering, or <Link href="/dashboard/orders" className="font-semibold underline underline-offset-2">view existing orders</Link>.</p> : <p><strong>{liveUnavailableCopy(currentLive?.reason ?? null).lead}</strong>{" "}{liveUnavailableCopy(currentLive?.reason ?? null).rest} <Link href="/dashboard/orders" className="font-semibold underline underline-offset-2">View existing orders</Link>.</p>}
          </div>

          <section aria-labelledby="services-title" className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-3.5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="inline-flex items-center gap-1.5 text-micro font-bold uppercase tracking-[0.16em] text-lav-700"><Sparkle className="h-3.5 w-3.5" /> Step 03</p>
                <h2 id="services-title" className="mt-1 text-[1rem] font-semibold text-ink">{selectedCategory ? `Explore ${selectedCategory.label}` : "Explore services"}</h2>
                <p aria-live="polite" className="mt-1 text-meta text-ink-3">{filtered.length} {`listing${filtered.length === 1 ? "" : "s"}`} · {category === "esim" && allEsimDestinations ? "all destinations" : `${selectedCountry.name} selected`}</p>
                {currentLive?.fetchedAt && <p className="mt-1 text-micro text-ink-3">Live listings checked: <time dateTime={currentLive.fetchedAt}>{new Date(currentLive.fetchedAt).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}</time></p>}
              </div>
              <div className="relative w-full sm:max-w-[260px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
                <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setVisible(PAGE_SIZE); }} aria-label="Search services" placeholder="Search services or platforms" className="min-h-11 w-full rounded-xl border border-line bg-white py-2 pl-9 pr-3 text-meta text-ink outline-none placeholder:text-ink-3 focus:border-lav-400 focus:ring-4 focus:ring-lav-100" />
              </div>
            </div>

            {currentLive?.unreadable && <p role="status" className="mt-3 text-meta text-amber-800">Plans were returned by one catalogue, but their details could not be read. Please try again later or contact support.</p>}
            {currentLive?.truncated && <p role="status" className="mt-3 text-meta text-amber-800">The all-destinations list is limited to the first 1,000 plans from one catalogue; more plans may exist.</p>}
            {category === "esim" && <div className="mt-4 rounded-xl border border-line bg-white p-3 text-meta text-ink-2">
              <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={allEsimDestinations} onChange={(event) => chooseEsimScope(event.target.checked)} /> Browse all destinations</label>
              <p className="mt-1">{allEsimDestinations ? "Plans may cover different destinations. Check each listing before ordering." : "Country-matched plans and digital listings with unconfirmed coverage appear together. Check each listing before ordering."}</p>
            </div>}
            {enableDigitalCatalogue && <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-meta text-ink-2">
              <label className="flex items-center gap-2"><input type="checkbox" checked={digitalStockOnly} onChange={(event) => { setDigitalStockOnly(event.target.checked); setVisible(PAGE_SIZE); }} /> Show catalogue listings with reported stock only</label>
            </div>}
            {enableDigitalCatalogue && search.trim().length >= 2 && <p className="mt-3 text-micro text-ink-3">{category === "all" && !digitalBrowse ? "Digital search covers all categories and may be limited to 50 results." : category === "gift-cards" && !digitalBrowse ? "Search includes loaded gift-card listings and up to 50 catalogue-wide matches. Load more listings to search further pages." : "Search filters the listings loaded in this category. Load more listings to search further pages."}</p>}

            {enableDigitalCatalogue && <DigitalCategoryPicker key={`${category}:${pickerRevision}`} category={category} onSelect={(entry) => { setDigitalBrowse(entry ? { category, entry } : null); setSearch(""); setVisible(PAGE_SIZE); }} />}
            {digitalBrowse?.category === category && <p className="mt-2 text-micro text-ink-3">This product-type selection filters digital catalogue listings only; other service offers remain visible.</p>}

            {category === "numbers" && (
              <div className="mt-4 rounded-xl border border-line bg-white px-3.5 py-3 text-meta leading-relaxed text-ink-2">
                Country-based catalogue plans do not have separate stock counts. Live rental listings may report stock;
                app-specific number listings and their reported stock appear under App verification.{" "}
                <button type="button" onClick={() => chooseCategory("verification")} className="font-semibold text-lav-700 underline underline-offset-2">
                  Browse app-specific numbers
                </button>
              </div>
            )}

            {tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-4" aria-label="Service types">
                <button type="button" onClick={() => { setTag("all"); setVisible(PAGE_SIZE); }} aria-pressed={tag === "all"} className={`rounded-lg px-2.5 py-1.5 text-micro font-semibold ${tag === "all" ? "bg-lav-100 text-lav-800" : "text-ink-3 hover:bg-cream"}`}>All types</button>
                {tags.map((type) => <button key={type} type="button" onClick={() => { setTag(type); setVisible(PAGE_SIZE); }} aria-pressed={tag === type} className={`rounded-lg px-2.5 py-1.5 text-micro font-semibold ${tag === type ? "bg-lav-100 text-lav-800" : "text-ink-3 hover:bg-cream"}`}>{type}</button>)}
              </div>
            )}

            {currentLive && (currentLive.reason === "funding" || currentLive.reason === "throttled" || currentLive.reason === "error") && (
              <p role="status" className="mt-4 text-meta text-amber-800">
                {currentLive.reason === "throttled" ? "Live listings were refreshed too quickly." : currentLive.reason === "funding" ? (currentLive.live ? "Some live listings are paused while we restock." : "Live listings are paused while we restock.") : "Some live listings could not be loaded."}{" "}
                {/* No Retry on a funding gap: retrying cannot restock it. */}
                {currentLive.reason !== "funding" && <button type="button" className="font-semibold underline" onClick={() => setLiveRevision((value) => value + 1)}>Retry</button>}
              </p>
            )}
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
                          <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-lav-50/70">
                            {itemArt(group.items[0], "sm")}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold text-ink">{group.platform}</span>
                          <span className="shrink-0 rounded-full bg-cream px-2 py-0.5 text-micro font-semibold text-ink-2">
                            {group.items.length}
                            <span className="sr-only"> {group.items.length === 1 ? "listing" : "listings"}</span>
                          </span>
                          <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`} />
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
            {digital.loading && <p role="status" className="mt-4 text-meta text-ink-2">Loading more listings…</p>}
            {digital.error && <p role="status" className="mt-4 text-meta text-amber-800">Some listings could not be loaded. <button type="button" onClick={digital.retry} className="font-semibold underline">Retry listings</button></p>}
            {digital.limited && <p className="mt-4 text-meta text-ink-3">Digital search is limited to 50 listings across all categories; refine your search to find more.</p>}
            {filtered.length === 0 && !digital.loading && !digital.error && (
              <div className="rounded-2xl border border-dashed border-line bg-cream/50 p-8 text-center">
                {!search && tag === "all" && (category === "data" || (category === "subscriptions" && !enableDigitalCatalogue)) ? (
                  <>
                    <p className="text-[0.875rem] font-semibold text-ink">{category === "data" ? "Mobile data plans are not connected yet" : "Subscriptions are not connected yet"}</p>
                    <p className="mt-1 text-meta text-ink-2">No plans or prices are available to order. Nothing will be charged.</p>
                    <Link href={category === "data" ? "/dashboard/data" : "/dashboard/digital"} className="mt-3 inline-block text-meta font-semibold text-lav-700 underline underline-offset-2">
                      {category === "data" ? "View data service status" : "View subscription service status"}
                    </Link>
                  </>
                ) : (
                  <>
                    <p className="text-[0.875rem] font-semibold text-ink">No listings match these filters</p>
                    <p className="mt-1 text-meta text-ink-2">Try another search, category or country. This doesn&apos;t indicate live availability.</p>
                  </>
                )}
                {(search || tag !== "all") && <button type="button" onClick={() => { setSearch(""); setTag("all"); setVisible(PAGE_SIZE); }} className="mt-3 text-meta font-semibold text-lav-700 underline underline-offset-2">Clear filters</button>}
              </div>
            )}
            {!platformGroups && visible < filtered.length && (
              <div className="mt-5 text-center">
                <button type="button" onClick={() => setVisible((current) => current + PAGE_SIZE)} className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2.5 text-meta font-semibold text-ink-2 transition-colors hover:border-lav-300 hover:text-lav-700">Show more <span className="text-ink-3">({filtered.length - visible} remaining)</span></button>
              </div>
            )}
            {digital.hasMore && <div className="mt-4 text-center"><button type="button" disabled={digital.loading || digital.loadingMore} onClick={() => { void digital.loadMore(); }} className="rounded-full border border-line bg-white px-4 py-2.5 text-meta font-semibold text-ink-2 disabled:opacity-50">{digital.loadingMore ? "Loading listings…" : "Load more digital listings"}</button></div>}
            {enableDigitalCatalogue && (category === "all" || ["esim", "subscriptions", "games", "topups", "gift-cards", "prepaid"].includes(category)) && <p className="mt-4 text-micro text-ink-3">Digital product stock is reported and may change. Country coverage and ordering eligibility must be confirmed separately. {category === "all" ? "Browse categories or load more listings to explore the catalogue." : ""}</p>}
            <p className="mt-5 border-t border-line pt-4 text-micro leading-relaxed text-ink-3">Stock means available inventory. My units means your remaining purchased units. Unknown and not tracked are not the same as zero. Listings do not guarantee platform support or verified coverage.</p>
          </section>
          {category === "gift-cards" && giftCardManager && <section id="wallet-gifts" aria-labelledby="wallet-gifts-title" className="scroll-mt-6 rounded-[1.5rem] border border-line bg-[#fffdfa] p-4 sm:p-6">
            <h2 id="wallet-gifts-title" className="text-lg font-semibold text-ink">Wallet gift cards and gift-card management</h2>
            <p className="mt-1 mb-4 text-meta text-ink-2">Send or redeem Pryva wallet credit, review your history, or manage previously listed brand cards.</p>
            {giftCardManager}
          </section>}
        </>
      )}
    </div>
  );
}
