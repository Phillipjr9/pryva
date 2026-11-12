"use client";

import { useEffect, useRef, useState } from "react";
import { fetchCatalogue } from "@/lib/platform/catalog-fetch";
import { retryAfterDeadline } from "@/lib/platform/retry-after";
import { useRetryCooldown } from "@/lib/platform/use-retry-cooldown";
import type { ExplorerItem, ExplorerFilter } from "@/lib/services/service-explorer";

type Reason = "environment" | "unconfigured" | "funding" | "sign-in" | "throttled" | "error" | null;
export type LiveState = {
  country: string; items: ExplorerItem[]; live: boolean; partial: boolean;
  failed: boolean; reason: Reason; fetchedAt: string | null; loading: boolean;
  retryAt?: number;
};
type Feed = "numbers" | "social" | "esim" | "verification";
const FEEDS: Feed[] = ["numbers", "social", "esim", "verification"];
const FEED_CATEGORIES: Record<Feed, string[]> = {
  numbers: ["numbers", "email"], social: ["social"], esim: ["esim"], verification: ["verification"],
};

type CachedFeeds = { scope: string; results: Map<Feed, LiveState> };
type State = { scope: string; value: LiveState; feeds: Array<[Feed, LiveState]>; pending: Feed[] };

function retryable(entry: LiveState): boolean {
  return entry.reason === "error" || entry.reason === "throttled";
}

function feedReason(entries: LiveState[], live: boolean, complete: boolean): Reason {
  const gaps = entries.filter((entry) => entry.failed || entry.partial || (!entry.live && entry.reason !== "unconfigured"));
  return gaps.some((entry) => entry.reason === "sign-in") ? "sign-in"
    : gaps.some((entry) => entry.reason === "error") ? "error"
    : gaps.some((entry) => entry.reason === "throttled") ? "throttled"
    : gaps.some((entry) => entry.reason === "funding") ? "funding"
    : gaps.some((entry) => entry.reason === "environment") ? "environment"
    : !live && complete ? "unconfigured" : null;
}

/** Independent requests let a fast feed render even while another is slow or
 * unavailable. Results are keyed to the country/scope and late requests cannot
 * restore listings for a destination the shopper has already left. */
export function useLiveServiceExplorer(country: string, revision: number, allEsimDestinations: boolean, category: ExplorerFilter = "all", enabled = true) {
  // A retry changes revision but not the browsing scope: keep successful feeds.
  const scope = `${country}:${allEsimDestinations}`;
  const [state, setState] = useState<State | null>(null);
  const cached = useRef<CachedFeeds | null>(null);
  useEffect(() => {
    if (!enabled) { cached.current = null; return; }
    const controller = new AbortController();
    const results = cached.current?.scope === scope ? new Map(cached.current.results) : new Map<Feed, LiveState>();
    const targets = FEEDS.filter((feed) => {
      const previous = results.get(feed);
      return !previous || (retryable(previous) && (previous.retryAt ?? 0) <= Date.now());
    });
    const pending = new Set(targets);
    function publish() {
      if (controller.signal.aborted) return;
      cached.current = { scope, results: new Map(results) };
      const entries = FEEDS.flatMap((feed) => results.has(feed) ? [results.get(feed)!] : []);
      const seen = new Set<string>();
      const items = entries.flatMap((entry) => entry.items).filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id); return true;
      });
      const gaps = entries.filter((entry) => entry.failed || entry.partial || (!entry.live && entry.reason !== "unconfigured"));
      const live = entries.some((entry) => entry.live);
      setState({ scope, feeds: [...results.entries()], pending: [...pending], value: { country, items, live, partial: gaps.length > 0,
        failed: entries.some((entry) => entry.failed), reason: feedReason(entries, live, entries.length === FEEDS.length),
        loading: pending.size > 0,
        fetchedAt: entries.flatMap((entry) => entry.fetchedAt ? [entry.fetchedAt] : []).sort().pop() ?? null,
      } });
    }
    // Preserve already-loaded results while a targeted retry is in flight.
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      if (results.size) publish();
      for (const feed of targets) {
        const params = new URLSearchParams({ country, feed });
        if (feed === "esim" && allEsimDestinations) params.set("allDestinations", "1");
        if (revision) params.set("refresh", "1");
        void (async () => {
          let value: LiveState = { country, items: [], live: false, partial: true,
            failed: true, reason: "error", fetchedAt: null, loading: false };
          try {
            const response = await fetchCatalogue(`/api/services/catalog?${params}`, controller.signal);
            const data = await response.json().catch(() => null);
            if (response.ok && data?.ok && data.country === country && Array.isArray(data.items)) {
              const reason: Reason = ["environment", "unconfigured", "funding"].includes(data.reason) ? data.reason : null;
              value = { country, items: data.items.filter((item: ExplorerItem) => item && typeof item.id === "string" && FEED_CATEGORIES[feed].includes(item.category)), live: data.live !== false, partial: !!data.partial,
                failed: false, reason: data.partial && !reason ? "error" : reason,
                fetchedAt: typeof data.fetchedAt === "string" && Number.isFinite(Date.parse(data.fetchedAt)) ? data.fetchedAt : null,
                loading: false };
            } else {
              if (response.status === 401) value.reason = "sign-in";
              else if (response.status === 429) value.reason = "throttled";
              value.retryAt = retryAfterDeadline(response.headers?.get("retry-after") ?? null, response.status === 429 ? 60_000 : 0);
            }
          } catch { /* Successful feeds remain visible; upstream details stay private. */ }
          if (controller.signal.aborted) return;
          const previous = results.get(feed);
          if (value.failed && previous?.items.length) {
            value = { ...value, items: previous.items, live: previous.live, fetchedAt: previous.fetchedAt };
          }
          results.set(feed, value);
          pending.delete(feed);
          publish();
        })();
      }
    });
    return () => controller.abort();
  }, [country, revision, allEsimDestinations, scope, enabled]);

  // Keep every result for category switching, but only report the health and
  // cooldown of feeds belonging to the shelf the customer is viewing.
  const relevant = category === "all" ? FEEDS : FEEDS.filter((feed) => category === "verification" ? feed === "verification" : FEED_CATEGORIES[feed].includes(category));
  const entries = state?.scope === scope ? state.feeds.filter(([feed]) => relevant.includes(feed)).map(([, value]) => value) : [];
  const retryAt = Math.max(0, ...entries.filter(retryable).map((entry) => entry.retryAt ?? 0));
  const retryBlocked = useRetryCooldown(retryAt);
  if (!enabled || state?.scope !== scope) return null;
  if (category === "all") return { ...state.value, retryBlocked };
  const gaps = entries.filter((entry) => entry.failed || entry.partial || (!entry.live && entry.reason !== "unconfigured"));
  const live = entries.some((entry) => entry.live);
  return { ...state.value, live, reason: feedReason(entries, live, relevant.length > 0 && entries.length === relevant.length),
    partial: gaps.length > 0, failed: entries.some((entry) => entry.failed),
    loading: state.pending.some((feed) => relevant.includes(feed)), retryBlocked,
    fetchedAt: entries.flatMap((entry) => entry.fetchedAt ? [entry.fetchedAt] : []).sort()[0] ?? null };
}
