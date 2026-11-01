import "server-only";
import { NUMBER_PROVIDERS } from "@/lib/order-providers";

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

export type LaneId = "numbers" | "accounts" | "boosts" | "scheduled";

export type LaneSpec = {
  id: LaneId;
  label: string;
  /** The `orders.provider` values this lane is accountable for. */
  providers: string[];
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

export const SERVICE_LANES: LaneSpec[] = [
  {
    id: "numbers",
    label: "Virtual numbers & rentals",
    // Every supplier that can sell a number: an order delivered from the second
    // one is still this lane's responsibility, and leaving it out would let it
    // go stale with no page saying so.
    providers: [...NUMBER_PROVIDERS],
    staleHours: 2,
    delivery: "The number is issued at purchase and the code is polled onto the order page.",
    recovery: "A number that never delivers is refunded by the nightly sweep and released upstream.",
  },
  {
    id: "accounts",
    label: "Accounts marketplace",
    providers: ["accounts", "manual"],
    staleHours: 48,
    delivery: "Credentials are written onto the order page the moment the supplier returns them.",
    recovery: "An ambiguous supplier call parks the order for review instead of charging twice; a refusal is refunded.",
  },
  {
    id: "boosts",
    label: "Social boosting",
    providers: ["smm"],
    staleHours: 168,
    delivery: "Opening the order reads the panel's status back; progress is shown on the order page.",
    recovery: "A partial or cancelled boost goes to review for a manual refund — never an automatic one.",
  },
  {
    id: "scheduled",
    label: "Scheduled purchases",
    providers: ["scheduled"],
    staleHours: 48,
    delivery: "The schedule buys the same plan when it runs.",
    recovery: "Disabled outside the preview database; nothing is charged while it is off.",
  },
];

/**
 * What the shop deliberately does not sell, and why.
 *
 * Listed here rather than left implicit because "why can't I buy an eSIM?" is a
 * support question, and because a lane appearing in the catalogue without a
 * delivery path is the exact defect this page exists to catch.
 */
export const NOT_FOR_SALE: Array<{ label: string; reason: string }> = [
  { label: "eSIM data", reason: "Catalogue only — no order path exists, and the purchase endpoint is not mounted." },
  { label: "Mobile data plans", reason: "The purchase endpoint answers 503 by design; no data supplier is contracted." },
  { label: "Residential proxies", reason: "Catalogue only — no supplier and no order path." },
  { label: "Subscriptions", reason: "The purchase endpoint answers 503 until a supplier exists." },
  { label: "Bulk baskets", reason: "Not built: quoting a basket needs the per-item purchase path to be proven first." },
  { label: "Airtime", reason: "The purchase endpoint answers 503 by design; no VTU supplier is contracted." },
];

export type OrderTally = {
  provider: string;
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
