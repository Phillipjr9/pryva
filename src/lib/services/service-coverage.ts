import "server-only";

import {
  ACCOUNTS_PROVIDER,
  ESIM_PROVIDER,
  MANUAL_PROVIDER,
  NUMBER_PROVIDERS,
  ORDER_PROVIDERS,
  SMM_PROVIDER,
} from "@/lib/services/order-providers";
import { LANES, LANE_IDS, SERVICES, type LaneId, type OrderServiceTag } from "@/lib/services/registry";

export type { LaneId };

/**
 * Can a customer actually receive what this shop sells?
 *
 * Every "is it configured?" question in this codebase is answered somewhere --
 * a key is present, a gate is open, a plan is fulfilable -- but the answers live
 * in a dozen files and none of them says whether a real customer, last week, got
 * what they paid for. That is the question the owner asks: *are the suppliers
 * working, and does everyone get their service?*
 *
 * So this module answers it from evidence rather than from hope. A lane is
 * healthy when an order in it reached `delivered` recently; it is untested when
 * it has never sold anything; it needs attention when orders exist but nothing
 * was ever delivered; and it is unavailable when the credential is missing, which
 * is the one state where the gates correctly refuse to take money at all.
 *
 * Gift cards are deliberately not a lane: they are Pryva-issued credit, delivered
 * by the purchase call itself, with no supplier to be late. Scoring them on order
 * history would report "untested" forever, and a page that cries wolf is worse
 * than no page.
 *
 * The summarising is pure so it can be pinned by tests without a database.
 */

export type LaneSpec = {
  id: LaneId;
  label: string;
  /** The `orders.provider` values this lane is accountable for. */
  providers: string[];
  /**
   * The `orders.service` values this lane owns, when a provider is shared.
   *
   * eSIM and virtual numbers are both delivered through the same gateway, so
   * `orders.provider` cannot tell them apart. Deriving the filter from the
   * registry means the lane that owns a service is decided in one place, and a
   * second family on the same gateway cannot silently inherit the first one's
   * delivery history.
   */
  services?: OrderServiceTag[];
  /**
   * How long an order may sit in `processing`/`active`/`review` before it is
   * stale. A number should resolve in minutes; a boost of ten thousand followers
   * legitimately takes days, so one threshold for all of them would cry wolf.
   */
  staleHours: number;
  /** How the customer receives what they paid for. */
  delivery: string;
  /** What happens when delivery fails. */
  recovery: string;
};

/**
 * Which supplier credentials feed each lane.
 *
 * The provider strings stay here, next to the rest of the server-only supplier
 * knowledge, rather than in the registry — the registry is imported by client
 * components, and a provider name is the one thing that must never reach them.
 */
const LANE_PROVIDERS: Record<LaneId, readonly string[]> = {
  numbers: NUMBER_PROVIDERS,
  esim: [ESIM_PROVIDER],
  accounts: [ACCOUNTS_PROVIDER, MANUAL_PROVIDER],
  boosts: [SMM_PROVIDER],
  proxies: [ORDER_PROVIDERS.liveOtp],
  subscriptions: [ORDER_PROVIDERS.liveOtp],
  data: [ORDER_PROVIDERS.liveOtp],
};

/** Providers this lane shares with another, which is why it needs a service filter. */
function sharedProviders(id: LaneId): string[] {
  return LANE_PROVIDERS[id].filter((provider) =>
    LANE_IDS.some((other) => other !== id && LANE_PROVIDERS[other].includes(provider)),
  );
}

/**
 * The lanes the console scores, built from the registry.
 *
 * Scheduled purchases are deliberately not a lane. They do not have a supplier
 * of their own: a run buys the real plan and writes the real provider, so its
 * order is counted by whichever lane sold it. The old `scheduled` lane keyed on
 * provider `scheduled`, which no order has written since scheduled runs started
 * buying through `fulfillPlan` — a lane that could only ever report "nothing has
 * ever been bought", on a page whose entire purpose is not to say that.
 */
export const SERVICE_LANES: LaneSpec[] = LANES.map((lane) => ({
  id: lane.id,
  label: lane.label,
  providers: [...LANE_PROVIDERS[lane.id]],
  services:
    sharedProviders(lane.id).length > 0
      ? SERVICES.filter((service) => service.lane === lane.id).flatMap((service) => [...service.orderServices])
      : undefined,
  staleHours: lane.staleHours,
  delivery: lane.delivery,
  recovery: lane.recovery,
}));

/**
 * What the shop deliberately does not sell, and why.
 *
 * Listed here rather than left implicit because "why can't I buy airtime?" is a
 * support question, and because a lane appearing in the catalogue without a
 * delivery path is the exact defect this page exists to catch.
 *
 * eSIM was listed here until the purchase path and its order queries were found
 * complete: the entry had gone stale, and it made the console contradict the
 * storefront, which has been selling eSIM for several releases.
 */
export const NOT_FOR_SALE: Array<{ label: string; reason: string }> = [
  { label: "Bulk baskets", reason: "Not built: quoting a basket needs the per-item purchase path to be proven first." },
  { label: "Airtime", reason: "The purchase endpoint answers 503 by design; no VTU supplier is contracted." },
];

export type OrderTally = {
  provider: string;
  /** Which product it was, where the caller grouped by it. */
  service?: string;
  status: string;
  total: number;
  /**
   * How many of these rows carry a reference code — the number itself, for a
   * virtual number. An `active` number order has already handed the customer
   * something usable; an `active` boost has handed them nothing yet, and the two
   * must not be counted as the same kind of evidence.
   */
  withCode: number;
  /** Most recent order in this provider/status pair, or null when unknown. */
  latest: Date | string | null;
};

export type Verdict = "unavailable" | "untested" | "delivering" | "needs-attention";

export type LaneHealth = {
  id: LaneId;
  label: string;
  delivery: string;
  recovery: string;
  configured: boolean;
  orders: number;
  /** Rows that reached the terminal `delivered` state. */
  delivered: number;
  /** `active` rows that already carry a reference code. */
  issued: number;
  failed: number;
  running: number;
  stale: number;
  lastDeliveryAt: Date | null;
  daysSinceDelivery: number | null;
  verdict: Verdict;
  headline: string;
};

const FAILED = new Set(["refunded", "expired", "review"]);

function toDate(value: Date | string | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString("en-NG")} ${count === 1 ? one : many}`;
}

/** A lane is "fresh" if something reached the customer inside this window. */
export const FRESH_DELIVERY_DAYS = 7;

export function summariseLane(args: {
  spec: LaneSpec;
  tallies: OrderTally[];
  stale: number;
  configured: boolean;
  now?: Date;
}): LaneHealth {
  const { spec, tallies, stale, configured } = args;
  const now = args.now ?? new Date();

  let orders = 0;
  let delivered = 0;
  let issued = 0;
  let failed = 0;
  let running = 0;
  let lastDeliveryAt: Date | null = null;

  for (const tally of tallies) {
    if (!spec.providers.includes(tally.provider)) continue;
    if (spec.services && tally.service !== undefined && !spec.services.some((tag) => tag === tally.service)) continue;
    orders += tally.total;
    const latest = toDate(tally.latest);
    if (tally.status === "delivered") {
      delivered += tally.total;
      if (latest && (!lastDeliveryAt || latest > lastDeliveryAt)) lastDeliveryAt = latest;
    } else if (tally.status === "active") {
      running += tally.total;
      issued += tally.withCode;
      // A number that has been issued and is waiting for its code is usable:
      // that is delivery evidence, unlike an `active` boost which has delivered
      // nothing yet.
      if (tally.withCode > 0 && latest && (!lastDeliveryAt || latest > lastDeliveryAt)) lastDeliveryAt = latest;
    } else if (FAILED.has(tally.status)) {
      failed += tally.total;
    }

    // Anything not counted above is still in flight (processing).
    const accounted = tally.status === "delivered" || tally.status === "active" || FAILED.has(tally.status);
    if (!accounted) running += tally.total;
  }

  const evidence = delivered + issued;
  const daysSinceDelivery = lastDeliveryAt
    ? Math.floor((now.getTime() - lastDeliveryAt.getTime()) / 86_400_000)
    : null;

  let verdict: Verdict;
  let headline: string;
  if (!configured) {
    verdict = "unavailable";
    headline = "Not configured — the gates refuse to take money for this lane.";
  } else if (orders === 0) {
    verdict = "untested";
    headline = "Configured, but nothing has ever been bought — no evidence yet that it delivers.";
  } else if (evidence > 0 && daysSinceDelivery !== null && daysSinceDelivery <= FRESH_DELIVERY_DAYS) {
    verdict = "delivering";
    headline = `Something reached a customer ${daysSinceDelivery === 0 ? "today" : `${plural(daysSinceDelivery, "day")} ago`}.`;
  } else if (evidence > 0) {
    verdict = "needs-attention";
    headline = `Nothing reached a customer in ${FRESH_DELIVERY_DAYS} days; the last delivery was ${plural(daysSinceDelivery ?? 0, "day")} ago.`;
  } else {
    verdict = "needs-attention";
    headline = `${plural(orders, "order")} taken and none reached a customer.`;
  }

  return {
    id: spec.id,
    label: spec.label,
    delivery: spec.delivery,
    recovery: spec.recovery,
    configured,
    orders,
    delivered,
    issued,
    failed,
    running,
    stale,
    lastDeliveryAt,
    daysSinceDelivery,
    verdict,
    headline,
  };
}

/** How many lanes are, right now, both configured and delivering. */
export function countingSummary(lanes: LaneHealth[]): { healthy: number; total: number } {
  return {
    total: lanes.length,
    healthy: lanes.filter((lane) => lane.verdict === "delivering").length,
  };
}
