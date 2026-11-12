"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { catalogueFailureReason, cataloguePool, fetchCatalogue, type CatalogueFailureReason } from "@/lib/platform/catalog-fetch";
import { retryAfterDeadline } from "@/lib/platform/retry-after";
import { useRetryCooldown } from "@/lib/platform/use-retry-cooldown";
import { parseDigitalArtwork } from "@/lib/content/digital-artwork";
import type { ExplorerFilter, ExplorerItem } from "@/lib/services/service-explorer";
import { digitalServiceFamily, DIGITAL_FAMILY_LABELS } from "@/lib/services/digital-service-category";
import { reportedGiftTerms } from "@/lib/services/gift-cards/reported-terms";

type Root = { slug: string; familyShelf?: string; category: ExplorerItem["category"]; label: string; icon: "esim" | "bulk" | "data" | "gift-cards" | "subscriptions" | "games" | "topups" | "prepaid"; giftCardsOnly?: boolean; allOnly?: boolean };
// Only known real product families. Test-order listings are not a customer shelf.
const ROOTS: Root[] = [
  { slug: "esim", category: "esim", label: "Travel eSIM", icon: "esim" },
  { slug: "subscriptions", category: "subscriptions", label: "Subscription", icon: "subscriptions" },
  { slug: "games", category: "games", label: "Game", icon: "games" },
  { slug: "game-currency", category: "games", label: "Game currency", icon: "games" },
  { slug: "gaming-services", category: "games", label: "Gaming service", icon: "games" },
  { slug: "topups", category: "topups", label: "Account top-up", icon: "topups" },
  { slug: "gift-cards", category: "gift-cards", label: "Gift card", icon: "gift-cards" },
  { slug: "app-stores", category: "gift-cards", label: "App store credit", icon: "gift-cards" },
  { slug: "rewarble", category: "gift-cards", label: "Digital voucher", icon: "gift-cards" },
  // Some gift cards are filed by the supplier under game currency instead.
  { slug: "game-currency", category: "gift-cards", label: "Gift card", icon: "gift-cards", giftCardsOnly: true },
  { slug: "prepaid-finance", category: "prepaid", label: "Prepaid product", icon: "prepaid" },
];
const ALL_PRODUCTS: Root = { slug: "", category: "tools", label: "Digital product · all categories", icon: "subscriptions", allOnly: true };

type Page = { root: Root; items: ExplorerItem[]; next: string | null; limited: boolean; error: boolean; reason?: CatalogueFailureReason; retryAt?: number };
type State = { scope: string; pages: Page[]; loading: boolean; loadingMore: boolean };

function retryable(page: Page): boolean {
  return page.error && (!page.reason || page.reason === "error" || page.reason === "throttled");
}

function mergePage(previous: Page, next: Page): Page {
  if (next.error) return { ...previous, error: true, reason: next.reason, retryAt: next.retryAt };
  const seen = new Set(previous.items.map((item) => item.id));
  return { ...next, items: [...previous.items, ...next.items.filter((item) => !seen.has(item.id))] };
}

function rootsFor(category: ExplorerFilter): Root[] {
  if (category !== "all") {
    const roots = ROOTS.filter((root) => root.category === category);
    // Also scan the whole catalogue for explicitly named gift cards which may
    // be filed under another family. This stream is cursor-paged like the rest.
    return category === "tools" || category === "email" ? roots : [...roots, ALL_PRODUCTS];
  }
  // Sample each shelf, plus a cursor-paged whole-catalogue stream so new or
  // unmapped families remain browsable in All services.
  return [...ROOTS.filter((root, index) => ROOTS.findIndex((other) => other.slug === root.slug) === index), ALL_PRODUCTS];
}
async function load(root: Root, query: string, cursor: string | undefined, signal: AbortSignal, stockOnly: boolean): Promise<Page> {
  const params = new URLSearchParams();
  if (root.slug) params.set("category", root.slug);
  if (stockOnly) params.set("stock", "available");
  if (query.length >= 2) params.set("q", query);
  else if (cursor) params.set("cursor", cursor);
  try {
    // The All view fans out across many shelves. Two attempts per shelf keep a
    // supplier outage from immediately consuming the entire browsing budget.
    const response = await fetchCatalogue(`/api/services/digital-catalog?${params}`, signal, { maxAttempts: 2 });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const reason = catalogueFailureReason(response.status, data?.code);
      // A missing throttle header is not permission for an immediate manual retry.
      const retryAt = retryAfterDeadline(response.headers?.get("retry-after") ?? null, reason === "throttled" ? 60_000 : 0);
      return { root, items: [], next: cursor ?? null, limited: false, error: true, reason, retryAt };
    }
    if (!data?.ok || !Array.isArray(data.items) ||
        !(data.nextCursor === null || (typeof data.nextCursor === "string" && data.nextCursor.length <= 512 && data.nextCursor !== cursor))) throw new Error("Unavailable");
    const items: ExplorerItem[] = [];
    for (const value of data.items) {
      if (!value || typeof value !== "object" || typeof value.id !== "string" || !/^digital-[a-f0-9]{24}$/.test(value.id) || typeof value.name !== "string" || !value.name || !["reported", "out", "unknown"].includes(value.stock)) continue;
      const checkout = value.checkout === "codes" || value.checkout === "topups" || value.checkout === "esims" ? value.checkout : null;
      const family = digitalServiceFamily(value.name, checkout ?? undefined, root.familyShelf ?? root.slug);
      if (root.giftCardsOnly && family !== "gift-cards") continue;
      const category = family ?? "tools";
      const label = family ? DIGITAL_FAMILY_LABELS[family] : "Digital product · category unconfirmed";
      const rawTerms = value.reportedTerms && typeof value.reportedTerms === "object" && !Array.isArray(value.reportedTerms) ? value.reportedTerms : null;
      const termValue = rawTerms?.value && typeof rawTerms.value === "object" && !Array.isArray(rawTerms.value) ? rawTerms.value : null;
      const terms = category === "gift-cards" ? reportedGiftTerms({ country_code: rawTerms?.country, amount: termValue?.amount, currency: termValue?.currency }) : null;
      const termDetails = [terms?.value ? `Reported value: ${terms.value.amount} ${terms.value.currency}` : null,
        terms?.country ? `Reported country: ${terms.country}` : null].filter(Boolean);
      items.push({ id: value.id, category, name: value.name, description: label, tag: label, ...(!family ? { allOnly: true } : {}),
        artwork: { kind: "digital-product", art: parseDigitalArtwork(value.artwork) }, source: "catalog", coverage: "unconfirmed", stock: typeof value.stockQuantity === "number" && Number.isSafeInteger(value.stockQuantity) && value.stockQuantity >= 0 ? value.stockQuantity : null, myUnits: null, price: null,
        detail: [`${value.stock === "reported" ? "Stock reported" : value.stock === "out" ? "Out of stock (reported)" : "Stock unknown"}`, ...termDetails, terms?.country ? "Redemption eligibility unconfirmed" : "region unconfirmed"].join(" · "), orderingPaused: !checkout || value.stock !== "reported", action: checkout && value.stock === "reported" ? { label: "Check price and availability", href: `/dashboard/digital-${checkout}?product=${encodeURIComponent(value.id)}` } : null });
    }
    return { root, items, next: data.nextCursor, limited: data.searchLimited === true, error: false };
  } catch {
    return { root, items: [], next: cursor ?? null, limited: false, error: true, reason: "error" };
  }
}

export function useDigitalExplorer(enabled: boolean, category: ExplorerFilter, search: string, stockOnly = true, subcategory: { id: string; name: string; root?: string } | null = null) {
  const query = search.trim().slice(0, 128);
  const globalSearch = category === "all" && !subcategory && query.length >= 2;
  const catalogQuery = globalSearch ? query : "";
  const [giftRevision, setGiftRevision] = useState(0);
  // Local category search reuses loaded pages instead of refetching every keypress.
  const scope = `${enabled}:${category}:${catalogQuery}:${stockOnly}:${subcategory?.id ?? ""}`;
  const [state, setState] = useState<State>({ scope: "", pages: [], loading: false, loadingMore: false });
  const [giftSearch, setGiftSearch] = useState<{ scope: string; page: Page } | null>(null);
  const giftQuery = enabled && category !== "all" && category !== "tools" && category !== "email" && !subcategory && query.length >= 2 ? query : "";
  const giftSearchScope = `${category}:${giftQuery}:${stockOnly}:${giftRevision}`;
  const controllerRef = useRef<AbortController | null>(null);
  const activePageWork = useRef<AbortSignal | null>(null);
  useEffect(() => {
    if (!giftQuery) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const root: Root = ALL_PRODUCTS;
      void load(root, giftQuery, undefined, controller.signal, stockOnly).then((page) => {
        if (!controller.signal.aborted) setGiftSearch({ scope: giftSearchScope, page });
      });
    }, 450);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [giftQuery, giftSearchScope, stockOnly]);
  useEffect(() => {
    const controller = new AbortController(); controllerRef.current = controller;
    // Upstream category search does not include descendants. Inside a service
    // category, filter browsed pages locally instead of mixing unrelated global
    // search results into that category; further pages remain accessible.
    const categoryRoots = rootsFor(category);
    const selectedRoot = subcategory && category === "all" ? ROOTS.find((root) => root.slug === subcategory.root) : categoryRoots[0];
    const chosen = subcategory
      ? [{ ...(selectedRoot ?? { ...ALL_PRODUCTS, allOnly: true }), slug: subcategory.id, familyShelf: subcategory.root ?? selectedRoot?.slug, label: subcategory.name, giftCardsOnly: false }]
      : categoryRoots;
    const roots = enabled ? (globalSearch ? [ALL_PRODUCTS] : chosen) : [];
    if (roots.length) {
      const timer = setTimeout(() => {
        const results = new Map<string, Page>();
        void cataloguePool(roots, async (root) => {
          await load(root, catalogQuery, undefined, controller.signal, stockOnly).then((page) => {
            if (controller.signal.aborted) return;
            results.set(root.slug, page);
            const pages = roots.flatMap((item) => results.has(item.slug) ? [results.get(item.slug)!] : []);
            setState({ scope, pages, loading: results.size < roots.length, loadingMore: false });
          });
        }, controller.signal);
      }, catalogQuery ? 450 : 0);
      return () => { clearTimeout(timer); controller.abort(); };
    }
    return () => controller.abort();
  }, [enabled, category, globalSearch, catalogQuery, scope, stockOnly, subcategory]);

  const current = state.scope === scope ? state : { scope, pages: [], loading: enabled && (globalSearch || rootsFor(category).length > 0), loadingMore: false };
  const extra = giftQuery && giftSearch?.scope === giftSearchScope ? giftSearch.page : null;
  const giftSearchLoading = !!giftQuery && !extra;
  const failures = [...current.pages, ...(extra ? [extra] : [])].filter((page) => page.error);
  const retryAt = Math.max(0, ...failures.filter(retryable).map((page) => page.retryAt ?? 0));
  const retryBlocked = useRetryCooldown(retryAt);

  const loadMore = useCallback(async () => {
    const signal = controllerRef.current?.signal;
    if (!signal || signal.aborted || activePageWork.current === signal || state.scope !== scope || state.loading || state.loadingMore || globalSearch || retryAt > Date.now()) return;
    // A failed page is retried separately so its cursor and earlier results survive.
    const pending = state.pages.filter((page) => page.next && !page.error);
    if (!pending.length) return;
    activePageWork.current = signal;
    setState((previous) => ({ ...previous, loadingMore: true }));
    try {
      const nextPages: Page[] = [];
      await cataloguePool(pending, async (page) => {
        nextPages.push(await load(page.root, "", page.next!, signal, stockOnly));
      }, signal);
      if (signal.aborted) return;
      setState((previous) => {
        if (previous.scope !== scope) return previous;
        const pages = previous.pages.map((page) => {
          const next = nextPages.find((result) => result.root.slug === page.root.slug);
          return next ? mergePage(page, next) : page;
        });
        return { ...previous, pages, loadingMore: false };
      });
    } finally {
      if (activePageWork.current === signal) activePageWork.current = null;
    }
  }, [state, scope, globalSearch, stockOnly, retryAt]);

  const retry = useCallback(async () => {
    const signal = controllerRef.current?.signal;
    if (!signal || signal.aborted || activePageWork.current === signal || state.scope !== scope || state.loading || state.loadingMore || giftSearchLoading || retryAt > Date.now()) return;
    if (extra && retryable(extra)) setGiftRevision((value) => value + 1);
    const pending = state.pages.filter(retryable);
    if (!pending.length) return;
    activePageWork.current = signal;
    setState((previous) => ({ ...previous, loadingMore: true }));
    try {
      await cataloguePool(pending, async (page) => {
        const next = await load(page.root, catalogQuery, page.next ?? undefined, signal, stockOnly);
        if (signal.aborted) return;
        setState((previous) => previous.scope !== scope ? previous : {
          ...previous, pages: previous.pages.map((old) => old.root.slug === page.root.slug ? mergePage(old, next) : old),
        });
      }, signal);
      if (!signal.aborted) setState((previous) => previous.scope !== scope ? previous : { ...previous, loadingMore: false });
    } finally {
      if (activePageWork.current === signal) activePageWork.current = null;
    }
  }, [state, scope, catalogQuery, stockOnly, extra, giftSearchLoading, retryAt]);

  const seen = new Set<string>();
  const items = [...current.pages.flatMap((page) => page.items), ...(extra?.items ?? [])].filter((item) => {
    if (category !== "all" && (item.allOnly || item.category !== category)) return false;
    if (seen.has(item.id)) return false;
    seen.add(item.id); return true;
  });
  // If failures differ, preserve a real outage rather than labelling all of
  // them as a harmless configuration or rate-limit condition.
  const reason = (["error", "sign-in", "throttled", "environment", "unconfigured"] as const)
    .find((candidate) => failures.some((page) => (page.reason ?? "error") === candidate)) ?? null;
  return { items, loading: current.loading || giftSearchLoading, pageLoading: current.loading, loadingMore: current.loadingMore, error: failures.length > 0, reason, retryBlocked,
    limited: current.pages.some((page) => page.limited) || !!extra?.limited, hasMore: !globalSearch && current.pages.some((page) => !!page.next && !page.error),
    loadMore, retry };
}
