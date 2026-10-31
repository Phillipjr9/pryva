/**
 * What a service can actually do right now.
 *
 * Kept apart from `service-readiness.ts` (which imports supplier configuration
 * and is therefore server-only) so the hub's client component can label a
 * category without pulling keys into the browser bundle.
 */
export type ServiceState = "buy" | "preview" | "free" | "paused" | "unavailable";

/** Customer-facing wording. Short enough for a badge, explicit enough to be true. */
export const SERVICE_STATE_LABEL: Record<ServiceState, string> = {
  buy: "Ready to buy",
  preview: "Catalogue only",
  free: "Free tool",
  paused: "Ordering paused",
  unavailable: "Not connected",
};

/** Where the state comes from, for the hub's summary line and the audit doc. */
export const SERVICE_STATE_NOTE: Record<ServiceState, string> = {
  buy: "ordering works end to end today",
  preview: "listings can be browsed; checkout is not open",
  free: "no payment involved",
  paused: "the supplier is not connected yet",
  unavailable: "no supplier integration exists yet",
};

/**
 * Display order: what a customer can do now, then what is nearly ready, then
 * what is only a catalogue, then what has nothing behind it. Ties keep the
 * catalogue's own order, so the arrangement is stable between renders.
 *
 *   buy 0 → free 1 → paused 2 → preview 3 → unavailable 4
 */
export const SERVICE_STATE_RANK: Record<ServiceState, number> = {
  buy: 0,
  free: 1,
  paused: 2,
  preview: 3,
  unavailable: 4,
};

export const SERVICE_STATE_DOT: Record<ServiceState, string> = {
  buy: "bg-emerald-500",
  preview: "bg-amber-400",
  free: "bg-indigo-400",
  paused: "bg-slate-400",
  unavailable: "bg-rose-400",
};

export type ServiceReadinessEntry = {
  id:
    | "verification"
    | "social"
    | "numbers"
    | "esim"
    | "proxies"
    | "email"
    | "accounts"
    | "subscriptions"
    | "data"
    | "tools";
  label: string;
  state: ServiceState;
  /** One sentence a customer can act on, shown beside the category. */
  detail: string;
};

/** Stable ordering used by the service hub and the dashboard tiles. */
export function orderByReadiness<T extends { state: ServiceState }>(entries: T[]): T[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) =>
      SERVICE_STATE_RANK[a.entry.state] - SERVICE_STATE_RANK[b.entry.state] || a.index - b.index,
    )
    .map(({ entry }) => entry);
}

/** A sentence for the hub: only the states that are actually present. */
export function readinessSummary(entries: Array<{ state: ServiceState }>): string {
  if (entries.length === 0) return "";
  const counts = new Map<ServiceState, number>();
  for (const entry of entries) counts.set(entry.state, (counts.get(entry.state) ?? 0) + 1);
  const order: ServiceState[] = ["buy", "free", "paused", "preview", "unavailable"];
  const parts = order
    .map((state) => ({ state, count: counts.get(state) ?? 0 }))
    .filter(({ count }) => count > 0)
    .map(({ state, count }) => `${count} ${SERVICE_STATE_LABEL[state].toLowerCase()}`);
  return `This deployment: ${parts.join(" · ")}.`;
}
