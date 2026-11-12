"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchCatalogue, SHARED_CATALOGUE_TIMEOUT_MS } from "@/lib/platform/catalog-fetch";
import { retryAfterDeadline } from "@/lib/platform/retry-after";
import { useRetryCooldown } from "@/lib/platform/use-retry-cooldown";
import { readLiveExplorerItems } from "@/lib/services/live-explorer-items";
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
const FEED_LABELS: Record<Feed, string> = {
  numbers: "Number plans and inboxes", social: "Social promotion", esim: "eSIM", verification: "App verification",
};

type State = { sessionKey: object; value: LiveState; feeds: Array<[Feed, LiveState]>; pending: Feed[] };
type Session = {
  scope: string; controller: AbortController; results: Map<Feed, LiveState>; pending: Set<Feed>;
  revision: number | null;
};

function feedsFor(category: ExplorerFilter): Feed[] {
  return category === "all" ? FEEDS : FEEDS.filter((feed) =>
    (category === "numbers" && feed === "verification") || FEED_CATEGORIES[feed].includes(category));
}
function retryable(entry: LiveState): boolean {
  return entry.reason === "error" || entry.reason === "throttled";
}
function hasGap(entry: LiveState): boolean {
  return entry.failed || entry.partial || (!entry.live && entry.reason !== "unconfigured");
}
function feedReason(entries: LiveState[], live: boolean, complete: boolean): Reason {
  const gaps = entries.filter(hasGap);
  return gaps.some((entry) => entry.reason === "sign-in") ? "sign-in"
    : gaps.some((entry) => entry.reason === "error") ? "error"
    : gaps.some((entry) => entry.reason === "throttled") ? "throttled"
    : gaps.some((entry) => entry.reason === "funding") ? "funding"
    : gaps.some((entry) => entry.reason === "environment") ? "environment"
    : !live && complete ? "unconfigured" : null;
}

/** Independent, on-demand feeds render as they arrive. Completed and in-flight
 * reads are reused when changing categories; a country/scope change aborts them. */
export function useLiveServiceExplorer(country: string, revision: number, allEsimDestinations: boolean, category: ExplorerFilter = "all", enabled = true) {
  const scope = `${country}:${allEsimDestinations}`;
  // Identity changes on every scope or enabled transition, including when the
  // shopper quickly returns to a previous country or reopens the explorer.
  // The old session's rows must not flash as current before the new effect runs.
  const sessionKey = useMemo(() => ({ scope, enabled }), [scope, enabled]);
  const [state, setState] = useState<State | null>(null);
  const session = useRef<Session | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const current: Session = { scope, controller: new AbortController(), results: new Map(), pending: new Set(), revision: null };
    session.current = current;
    return () => {
      current.controller.abort();
      if (session.current === current) session.current = null;
    };
  }, [scope, enabled, sessionKey]);

  useEffect(() => {
    const current = session.current;
    if (!enabled || !current || current.scope !== scope || current.controller.signal.aborted) return;
    const explicitRetry = current.revision !== null && current.revision !== revision;
    current.revision = revision;
    const targets = feedsFor(category).flatMap((feed) => {
      if (current.pending.has(feed)) return [];
      const previous = current.results.get(feed);
      if (!previous) return [{ feed, refresh: false }];
      return explicitRetry && retryable(previous) && (previous.retryAt ?? 0) <= Date.now()
        ? [{ feed, refresh: true }] : [];
    });
    for (const { feed } of targets) current.pending.add(feed);

    function publish() {
      if (current!.controller.signal.aborted) return;
      const entries = FEEDS.flatMap((feed) => current!.results.has(feed) ? [current!.results.get(feed)!] : []);
      const seen = new Set<string>();
      const items = entries.flatMap((entry) => entry.items).filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id); return true;
      });
      const gaps = entries.filter(hasGap);
      const live = entries.some((entry) => entry.live);
      setState({ sessionKey, feeds: [...current!.results.entries()], pending: [...current!.pending], value: {
        country, items, live, partial: gaps.length > 0, failed: entries.some((entry) => entry.failed),
        reason: feedReason(entries, live, entries.length === FEEDS.length), loading: current!.pending.size > 0,
        // The oldest checked feed is the conservative timestamp for a combined view.
        fetchedAt: entries.flatMap((entry) => entry.fetchedAt ? [entry.fetchedAt] : []).sort()[0] ?? null,
      } });
    }

    // Publish pending state before starting reads. An unrelated slow feed never
    // blocks a successful one, and browsing a single shelf does not fan out to
    // every supplier or spend their shared rate budgets.
    void Promise.resolve().then(() => {
      if (current.controller.signal.aborted) return;
      publish();
      for (const { feed, refresh } of targets) {
        const params = new URLSearchParams({ country, feed });
        if (feed === "esim" && allEsimDestinations) params.set("allDestinations", "1");
        if (refresh) params.set("refresh", "1");
        void (async () => {
          let value: LiveState = { country, items: [], live: false, partial: true,
            failed: true, reason: "error", fetchedAt: null, loading: false };
          try {
            const response = await fetchCatalogue(`/api/services/catalog?${params}`, current.controller.signal, { timeoutMs: SHARED_CATALOGUE_TIMEOUT_MS });
            const data = await response.json().catch(() => null);
            if (response.ok && data?.ok === true && data.country === country && Array.isArray(data.items)) {
              const declaredReason: Reason = ["environment", "unconfigured", "funding"].includes(data.reason) ? data.reason : null;
              const live = data.live === true;
              // Missing or contradictory availability metadata cannot establish
              // that a row is live. Never turn an ambiguous payload into stock.
              const invalidState = typeof data.live !== "boolean" || (!live && !declaredReason) ||
                (live && (declaredReason === "environment" || declaredReason === "unconfigured"));
              const malformedPartial = data.partial !== undefined && typeof data.partial !== "boolean";
              const parsed = live && !invalidState ? readLiveExplorerItems(data.items, FEED_CATEGORIES[feed], country) : { items: [], incomplete: false };
              const partial = data.partial === true || parsed.incomplete || invalidState || malformedPartial;
              value = { country, items: parsed.items, live: live && !invalidState, partial,
                failed: invalidState || (parsed.incomplete && parsed.items.length === 0 && data.items.length > 0),
                reason: parsed.incomplete || invalidState || malformedPartial ? "error" : partial && !declaredReason ? "error" : declaredReason,
                fetchedAt: typeof data.fetchedAt === "string" && Number.isFinite(Date.parse(data.fetchedAt)) ? data.fetchedAt : null,
                retryAt: partial ? retryAfterDeadline(response.headers?.get("retry-after") ?? null) : undefined,
                loading: false };
            } else {
              if (response.status === 401) value.reason = "sign-in";
              else if (response.status === 429) value.reason = "throttled";
              value.retryAt = retryAfterDeadline(response.headers?.get("retry-after") ?? null, response.status === 429 ? 60_000 : 0);
            }
          } catch { /* Working feeds remain visible; upstream details stay private. */ }
          if (current.controller.signal.aborted) return;
          const previous = current.results.get(feed);
          if (value.failed && previous?.items.length) {
            value = { ...value, items: previous.items, live: previous.live, fetchedAt: previous.fetchedAt };
          }
          current.results.set(feed, value);
          current.pending.delete(feed);
          publish();
        })();
      }
    });
  }, [country, revision, allEsimDestinations, scope, enabled, category, sessionKey]);

  // Report only the selected shelf's status; unrelated failures do not make a
  // healthy shelf look broken. Missing, not-yet-started feeds are still loading.
  const relevant = feedsFor(category);
  const scopedFeeds = state?.sessionKey === sessionKey ? state.feeds : [];
  const entries = scopedFeeds.filter(([feed]) => relevant.includes(feed)).map(([, value]) => value);
  const retryableEntries = scopedFeeds.filter(([feed, entry]) =>
    relevant.includes(feed) && retryable(entry) && !state?.pending.includes(feed)).map(([, entry]) => entry);
  // Retry can proceed as soon as any failed feed is eligible, even while an
  // unrelated feed is still loading. Each feed keeps its own cooldown.
  const retryAt = retryableEntries.length ? Math.min(...retryableEntries.map((entry) => entry.retryAt ?? 0)) : 0;
  const retryBlocked = useRetryCooldown(retryAt);
  const canRetry = retryableEntries.length > 0 && !retryBlocked;
  const verificationFeed = scopedFeeds.find(([feed]) => feed === "verification")?.[1] ?? null;
  const socialFeed = scopedFeeds.find(([feed]) => feed === "social")?.[1] ?? null;
  const numbersFeed = scopedFeeds.find(([feed]) => feed === "numbers")?.[1] ?? null;
  const verificationRetryBlocked = useRetryCooldown(verificationFeed && retryable(verificationFeed) ? verificationFeed.retryAt ?? 0 : 0);
  if (!enabled || state?.sessionKey !== sessionKey) return null;
  const isPending = (feed: Feed) => state.pending.includes(feed) || (relevant.includes(feed) && !scopedFeeds.some(([name]) => name === feed));
  const verificationLoading = isPending("verification");
  const socialLoading = isPending("social");
  const numbersLoading = isPending("numbers");
  const gaps = entries.filter(hasGap);
  const live = entries.some((entry) => entry.live);
  const affectedFeeds = scopedFeeds.filter(([feed, entry]) => relevant.includes(feed) && hasGap(entry)).map(([feed]) => FEED_LABELS[feed]);
  return { ...state.value, live, reason: feedReason(entries, live, relevant.length > 0 && entries.length === relevant.length),
    partial: gaps.length > 0, failed: entries.some((entry) => entry.failed),
    loading: relevant.some(isPending), retryBlocked, canRetry, verificationFeed, verificationLoading, verificationRetryBlocked, socialFeed, socialLoading, numbersFeed, numbersLoading, affectedFeeds,
    fetchedAt: entries.flatMap((entry) => entry.fetchedAt ? [entry.fetchedAt] : []).sort()[0] ?? null };
}
