import "server-only";

import { and, eq, isNull, lt, ne } from "drizzle-orm";

import { db } from "@/db";
import { orders } from "@/db/schema";
import { SINGLE_NUMBER_WINDOW } from "@/lib/refund-policy";

/**
 * Close rentals whose term has run out.
 *
 * A rental only reaches `expired` today if its owner happens to open the order
 * page, because that page is what calls the supplier's status check. Somebody who
 * bought thirty days and never came back still sees an active rental years later,
 * and the dashboard keeps counting a finished thing as live.
 *
 * This is bookkeeping, not delivery: no supplier is asked anything, and nothing
 * about money moves. The row says the term ended, which the expiry date already
 * says on its own.
 *
 * Two deliberate exclusions:
 *
 *  - **Single-use numbers are left alone.** Their window closing without a code is
 *    the auto-refund sweep's case, and marking them `expired` first would make the
 *    refund ineligible. This runs after that sweep anyway; the exclusion means the
 *    ordering can never be the thing that loses somebody their money.
 *  - **Refunded rows stay refunded.** `refundedAt` is the ledger's word, and a
 *    date passing must not overwrite it.
 */
export async function expireFinishedRentals(now: Date = new Date()): Promise<{ expired: number }> {
  const closed = await db
    .update(orders)
    .set({ status: "expired" })
    .where(
      and(
        eq(orders.status, "active"),
        ne(orders.duration, SINGLE_NUMBER_WINDOW),
        isNull(orders.refundedAt),
        lt(orders.expiresAt, now),
      ),
    )
    .returning({ id: orders.id });

  return { expired: closed.length };
}
