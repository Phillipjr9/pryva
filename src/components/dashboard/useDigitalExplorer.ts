"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExplorerFilter, ExplorerItem } from "@/lib/services/service-explorer";

type Root = { slug: string; category: ExplorerItem["category"]; label: string; icon: "esim" | "bulk" | "data" | "gift-cards" | "subscriptions" | "games" | "topups" | "prepaid" };
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
  { slug: "prepaid-finance", category: "prepaid", label: "Prepaid product", icon: "prepaid" },
];
type Page = { root: Root; items: ExplorerItem[]; next: string | null; limited: boolean; error: boolean };
type State = { scope: string; pages: Page[]; loading: boolean; loadingMore: boolean };

function rootsFor(category: ExplorerFilter): Root[] {
  if (category !== "all") return ROOTS.filter((root) => root.category === category);
  // A sample from each shelf on the overview; selecting a shelf loads all of
  // its subcategories. Bounded to one request per family, not the entire tree.
  return ROOTS.filter((root, index) => ROOTS.findIndex((other) => other.category === root.category) === index);
}
async function load(root: Root, query: string, cursor: string | undefined, signal: AbortSignal): Promise<Page> {
  const params = new URLSearchParams({ category: root.slug, stock: "available" });
  if (query.length >= 2) params.set("q", query);
  else if (cursor) params.set("cursor", cursor);
  try {
    const response = await fetch(`/api/services/digital-catalog?${params}`, { cache: "no-store", signal });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok || !Array.isArray(data.items) ||
        !(data.nextCursor === null || (typeof data.nextCursor === "string" && data.nextCursor.length <= 512 && data.nextCursor !== cursor))) throw new Error("Unavailable");
    const items: ExplorerItem[] = [];
    for (const value of data.items) {
      if (!value || typeof value !== "object" || typeof value.id !== "string" || !/^digital-[a-f0-9]{24}$/.test(value.id) || typeof value.name !== "string" || !value.name || value.stock !== "reported") continue;
      const checkout = value.checkout === "codes" || value.checkout === "topups" || value.checkout === "esims" ? value.checkout : null;
      items.push({ id: value.id, category: root.category, name: value.name, description: root.label, tag: root.label,
        artwork: { kind: "service", name: root.icon }, source: "catalog", coverage: "unconfirmed", stock: null, myUnits: null, price: null,
        detail: "Stock reported · region unconfirmed", orderingPaused: !checkout, action: checkout ? { label: "Check price and availability", href: `/dashboard/digital-${checkout}?product=${encodeURIComponent(value.id)}` } : null });
    }
    return { root, items, next: data.nextCursor, limited: data.searchLimited === true, error: false };
  } catch {
    return { root, items: [], next: cursor ?? null, limited: false, error: true };
  }
}

export function useDigitalExplorer(enabled: boolean, category: ExplorerFilter, search: string) {
  const query = search.trim().slice(0, 128);
  const [revision, setRevision] = useState(0);
  const scope = `${enabled}:${category}:${query}:${revision}`;
  const [state, setState] = useState<State>({ scope: "", pages: [], loading: false, loadingMore: false });
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController(); controllerRef.current = controller;
    const roots = enabled ? rootsFor(category) : [];
    if (roots.length) {
      const timer = setTimeout(() => {
        const results = new Map<string, Page>();
        for (const root of roots) {
          void load(root, query, undefined, controller.signal).then((page) => {
            if (controller.signal.aborted) return;
            results.set(root.slug, page);
            const pages = roots.flatMap((item) => results.has(item.slug) ? [results.get(item.slug)!] : []);
            setState({ scope, pages, loading: results.size < roots.length, loadingMore: false });
          });
        }
      }, query ? 450 : 0);
      return () => { clearTimeout(timer); controller.abort(); };
    }
    return () => controller.abort();
  }, [enabled, category, query, scope, revision]);

  const current = state.scope === scope ? state : { scope, pages: [], loading: enabled && rootsFor(category).length > 0, loadingMore: false };
  const loadMore = useCallback(async () => {
    const signal = controllerRef.current?.signal;
    if (!signal || signal.aborted || state.scope !== scope || state.loading || state.loadingMore || query.length >= 2) return;
    const pending = state.pages.filter((page) => page.next && !page.error);
    if (!pending.length) return;
    setState((previous) => ({ ...previous, loadingMore: true }));
    const nextPages = await Promise.all(pending.map((page) => load(page.root, query, page.next!, signal)));
    if (signal.aborted) return;
    setState((previous) => {
      if (previous.scope !== scope) return previous;
      const pages = previous.pages.map((page) => {
        const next = nextPages.find((result) => result.root.slug === page.root.slug);
        if (!next) return page;
        if (next.error) return { ...page, error: true };
        const seen = new Set(page.items.map((item) => item.id));
        return { ...next, items: [...page.items, ...next.items.filter((item) => !seen.has(item.id))] };
      });
      return { ...previous, pages, loadingMore: false };
    });
  }, [state, scope, query]);
  const seen = new Set<string>();
  const items = current.pages.flatMap((page) => page.items).filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id); return true;
  });
  return { items, loading: current.loading, loadingMore: current.loadingMore, error: current.pages.some((page) => page.error),
    limited: current.pages.some((page) => page.limited), hasMore: query.length < 2 && current.pages.some((page) => !!page.next && !page.error),
    loadMore, retry: () => setRevision((value) => value + 1) };
}
