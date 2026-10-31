import "server-only";

import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { orders, type Order } from "@/db/schema";
import { getSmmOrderStatus, isSmmPanelConfigured, type SmmOrderState } from "@/lib/smm-panel";

/**
 * Reading a boost's delivery state back from the panel.
 *
 * A boost order used to be write-once: `placeBoostOrder` created the row at
 * `processing`, flipped it to `active` when `add` was accepted, and nothing ever
 * looked again. The panel's `status` call existed — `getSmmOrderStatus` — but no
 * code path called it, so an order that the panel cancelled, or delivered
 * partially, still read `active` in the customer's dashboard forever. That is the
 * one claim this product must never make wrongly: `active` is read as "you have
 * what you paid for", and for a boost it meant only "the panel accepted it".
 *
 * ## Why this is a read and never a retry
 *
 * `add` has no idempotency key, so nothing here may ever call it again; this
 * module only ever asks the panel what happened to the order it already has a
 * reference for. A panel that cannot be reached leaves the row exactly as it was
 * — an unreachable panel is not evidence of failure.
 *
 * ## Why the terminal states win
 *
 * Once a row says `delivered`, `review` or `refunded`, a stale panel answer must
 * not overwrite it. `refunded` in particular means money moved, and a status read
 * is not allowed to contradict the ledger.
 */

export const BOOST_PROVIDER = "smm";

/** Row states still waiting on the panel. Everything else is settled. */
const OPEN_STATUSES = new Set(["active", "processing"]);

/**
 * How long one order's answer is reused.
 *
 * The panel throttles sustained polling, and this runs on a page view, so a
 * customer holding down refresh must not become a status poll. `getSmmOrderStatus`
 * itself is a cheap single call; the point of the window is etiquette, not load.
 */
const COOLDOWN_MS = 60_000;

const lastChecked = new Map<string, number>();

/** Test seam: the cooldown map is process-local, so a test must be able to clear it. */
export function clearBoostStatusCache(): void {
  lastChecked.clear();
}

export type BoostSyncResult = {
  /** True when the panel actually answered. False means "no news", not "failed". */
  synced: boolean;
  reportedState: SmmOrderState | null;
  /** The row status after this read, when it changed. */
  status: string | null;
  startCount: number | null;
  remains: number | null;
};

const NO_NEWS: BoostSyncResult = {
  synced: false,
  reportedState: null,
  status: null,
  startCount: null,
  remains: null,
};

/**
 * The panel's vocabulary, mapped onto the statuses this app already renders.
 *
 * `pending`/`in_progress` deliberately return null: the row already says what it
 * needs to say, and rewriting `processing` on every read would churn the table
 * without telling anyone anything.
 */
export function orderStatusForState(state: SmmOrderState): string | null {
  switch (state) {
    case "completed":
      return "delivered";
    case "partial":
      // Partially delivered is not a product answer, it is a refund decision.
      return "review";
    case "canceled":
      // Money is not refunded here: cancelling upstream and refunding the wallet
      // are two separate acts, and silently marking a row `refunded` without
      // crediting the customer would be a lie in the other direction.
      return "review";
    default:
      return null;
  }
}

type SyncableOrder = Pick<Order, "id" | "provider" | "providerRequestId" | "status"> & {
  reconciliationNote?: string | null;
};

/**
 * Ask the panel where one order stands and record what it says.
 *
 * Never throws: it runs while rendering somebody's order page, and a delivery
 * lookup that fails must degrade to the stored state rather than take the page
 * down.
 */
export async function syncBoostOrderStatus(
  order: SyncableOrder,
  options: { skipCooldown?: boolean } = {},
): Promise<BoostSyncResult> {
  if (order.provider !== BOOST_PROVIDER) return NO_NEWS;
  const panelOrderId = order.providerRequestId?.trim();
  if (!panelOrderId) return NO_NEWS;
  if (!OPEN_STATUSES.has(order.status)) return NO_NEWS;
  if (!isSmmPanelConfigured()) return NO_NEWS;

  if (!options.skipCooldown) {
    const previous = lastChecked.get(order.id);
    const now = Date.now();
    if (previous !== undefined && now - previous < COOLDOWN_MS) return NO_NEWS;
    // Recorded before the call so a panel that hangs or errors also cools down.
    lastChecked.set(order.id, now);
  }

  let report;
  try {
    report = await getSmmOrderStatus(panelOrderId);
  } catch (error) {
    console.error("[boosts] status read failed", error);
    return NO_NEWS;
  }

  const next = orderStatusForState(report.status);
  const result: BoostSyncResult = {
    synced: true,
    reportedState: report.status,
    status: next,
    startCount: report.startCount,
    remains: report.remains,
  };

  if (next && next !== order.status) {
    // Only fill a note that is not already there: an operator's explanation of a
    // failed automatic refund outranks ours.
    const note =
      next !== "review" || order.reconciliationNote
        ? undefined
        : report.status === "canceled"
          ? `Supplier reports the boost cancelled (${report.orderId}); no automatic refund was issued.`
          : `Supplier reports a partial delivery (${report.remains === null ? "unknown" : report.remains} units remaining); review before refunding.`;
    try {
      await db
        .update(orders)
        .set(note ? { status: next, reconciliationNote: note } : { status: next })
        .where(eq(orders.id, order.id));
    } catch (error) {
      // The read still happened and is still worth showing; the write can be
      // repeated by the next viewer.
      console.error("[boosts] status write failed", error);
    }
  }

  return result;
}

/**
 * The sweep.
 *
 * Reading an order back only when its owner opens the page is not delivery
 * supervision — it is delivery supervision for the customers who happen to log
 * in. A boost the panel cancelled on Tuesday would still read `active` on
 * Friday for anyone who never looked, and the row would never reach a human.
 *
 * So the nightly job asks about every open boost. It stays a *read*: `add` is
 * never repeated, terminal rows are never overwritten, and a panel that cannot
 * be reached leaves the row exactly as it was. What changes is that an order
 * left open by the panel now lands in `review` with a note, where somebody can
 * see it, instead of sitting in `active` pretending to be a delivery.
 *
 * The cap exists because this runs inside a 60 s cron: one panel call per order,
 * oldest first, so the long-running ones are asked about every night and the
 * backlog still drains. Whatever is left over is picked up tomorrow.
 */
export type BoostSweepResult = {
  checked: number;
  changed: number;
  delivered: number;
  review: number;
  /** The panel answered and nothing needs to change (still running). */
  quiet: number;
  /** No answer at all: unreachable panel or a cooldown that swallowed the read. */
  unanswered: number;
  skipped: string | null;
};

export async function sweepBoostDeliveries(limit = 25): Promise<BoostSweepResult> {
  const result: BoostSweepResult = {
    checked: 0,
    changed: 0,
    delivered: 0,
    review: 0,
    quiet: 0,
    unanswered: 0,
    skipped: null,
  };

  if (!isSmmPanelConfigured()) {
    result.skipped = "panel not configured";
    return result;
  }

  let open: Array<Pick<Order, "id" | "provider" | "providerRequestId" | "status"> & {
    reconciliationNote: string | null;
  }>;
  try {
    open = await db
      .select({
        id: orders.id,
        provider: orders.provider,
        providerRequestId: orders.providerRequestId,
        status: orders.status,
        reconciliationNote: orders.reconciliationNote,
      })
      .from(orders)
      .where(
        and(
          eq(orders.provider, BOOST_PROVIDER),
          inArray(orders.status, [...OPEN_STATUSES]),
          isNotNull(orders.providerRequestId),
        ),
      )
      .orderBy(asc(orders.createdAt))
      .limit(limit);
  } catch (error) {
    console.error("[boosts] sweep read failed", error);
    result.skipped = "could not read open orders";
    return result;
  }

  for (const order of open) {
    result.checked += 1;
    // The cooldown is for page views; a nightly sweep is allowed to ask.
    const sync = await syncBoostOrderStatus(order, { skipCooldown: true });
    if (!sync.synced) {
      result.unanswered += 1;
      continue;
    }
    if (sync.status && sync.status !== order.status) {
      result.changed += 1;
      if (sync.status === "delivered") result.delivered += 1;
      if (sync.status === "review") result.review += 1;
    } else {
      result.quiet += 1;
    }
  }

  return result;
}
