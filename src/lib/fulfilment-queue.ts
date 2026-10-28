/**
 * Shared rules for the hand-sourced fulfilment queue — SERVER ONLY.
 *
 * The queue's API route and its admin screen must agree on what a queued order
 * is and how many credentials it needs, or an admin can deliver the wrong count.
 * Both read those rules from here.
 */

import "server-only";

import { MANUAL_PROVIDER } from "@/lib/order-providers";

/**
 * Order provider value for hand-sourced items.
 *
 * Distinct from `"accounts"` on purpose: the purchase route blocks a new
 * automated supplier order while an earlier one is unresolved, because a second
 * supplier call could double-spend. A hand-sourced order makes no supplier call,
 * so it must not trip that guard while it waits to be filled.
 */
export { MANUAL_PROVIDER };

/** Statuses that belong in the queue. `review` means "could not be sourced". */
export const QUEUE_STATUSES = ["processing", "review"] as const;

export const MAX_QUEUE_ITEMS = 50;

/**
 * Units in an order, read back from the label the purchase route wrote
 * ("3 × account"). Falls back to 1 rather than guessing higher: delivering too
 * many credentials is worse than asking the admin to check.
 */
export function quantityFromPlanLabel(planLabel: string): number {
  const match = /^(\d{1,3})\s*×\s*account$/u.exec(String(planLabel ?? "").trim());
  if (!match) return 1;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_QUEUE_ITEMS ? value : 1;
}

/** True when an order still needs an admin action. */
export function isAwaitingFulfilment(status: string): boolean {
  return status === "processing";
}
