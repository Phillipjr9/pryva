"use client";

import { useEffect, useState } from "react";
import { fetchCatalogue } from "@/lib/platform/catalog-fetch";
import type { ExplorerItem } from "@/lib/services/service-explorer";

type Reason = "environment" | "unconfigured" | "funding" | "throttled" | "error" | null;
export type LiveState = {
  country: string; items: ExplorerItem[]; live: boolean; partial: boolean;
  failed: boolean; reason: Reason; fetchedAt: string | null; loading: boolean;
};
type Feed = "numbers" | "social" | "esim" | "verification";
const FEEDS: Feed[] = ["numbers", "social", "esim", "verification"];
const FEED_CATEGORIES: Record<Feed, string[]> = {
  numbers: ["numbers", "email", "verification"], social: ["social"], esim: ["esim"], verification: ["verification"],
};

/** Independent requests let a fast feed render even while another is slow or
 * unavailable. Results are keyed to the country/scope and late requests cannot
 * restore listings for a destination the shopper has already left. */
export function useLiveServiceExplorer(country: string, revision: number, allEsimDestinations: boolean) {
  const scope = `${country}:${revision}:${allEsimDestinations}`;
  const [state, setState] = useState<{ scope: string; value: LiveState } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const results = new Map<Feed, LiveState>();
    function publish() {
      if (controller.signal.aborted) return;
      const entries = FEEDS.flatMap((feed) => results.has(feed) ? [results.get(feed)!] : []);
      const seen = new Set<string>();
      const items = entries.flatMap((entry) => entry.items).filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id); return true;
      });
      const gaps = entries.filter((entry) => entry.failed || entry.partial || (!entry.live && entry.reason !== "unconfigured"));
      const live = entries.some((entry) => entry.live);
      const reason: Reason = gaps.some((entry) => entry.reason === "error") ? "error"
        : gaps.some((entry) => entry.reason === "throttled") ? "throttled"
        : gaps.some((entry) => entry.reason === "funding") ? "funding"
        : gaps.some((entry) => entry.reason === "environment") ? "environment"
        : !live && entries.length === FEEDS.length ? "unconfigured" : null;
      setState({ scope, value: { country, items, live, partial: gaps.length > 0,
        failed: entries.some((entry) => entry.failed), reason,
        loading: results.size < FEEDS.length,
        fetchedAt: entries.flatMap((entry) => entry.fetchedAt ? [entry.fetchedAt] : []).sort().pop() ?? null,
      } });
    }
    for (const feed of FEEDS) {
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
          } else if (response.status === 429) value.reason = "throttled";
        } catch { /* Successful feeds remain visible; upstream details stay private. */ }
        results.set(feed, value);
        publish();
      })();
    }
    return () => controller.abort();
  }, [country, revision, allEsimDestinations, scope]);
  return state?.scope === scope ? state.value : null;
}
