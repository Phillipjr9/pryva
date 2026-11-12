import "server-only";

import { and, countDistinct, eq, gt, isNull, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { isPreviewDatabase } from "@/lib/platform/demo-policy";

/**
 * Count the customer's currently rented phone numbers, not every active order.
 * Number rentals use `rent-*` plan slugs; single-verification `vn-*` plans are
 * a different product. A fulfilled rental has one assigned referenceCode and a
 * finite expiry. Exclude unconfirmed/blank numbers and unknown or elapsed terms
 * rather than treating an old `active` status as proof that a number is live.
 *
 * Count distinct assigned numbers, ignoring phone-number formatting: bulk
 * checkout records one order per unit, and overlapping orders for the same
 * number should not inflate the headline. The expiry check is independent of
 * the nightly status sweep. Refunded rows stay excluded even if an inconsistent
 * status has not caught up with the ledger.
 */
export async function countActiveRentedNumbers(userId: string, now: Date): Promise<number> {
  const matchingRentals = and(
    eq(orders.userId, userId),
    eq(orders.service, "numbers"),
    eq(orders.status, "active"),
    like(orders.productSlug, "rent-%"),
    gt(orders.expiresAt, now),
    isNull(orders.refundedAt),
  );

  if (isPreviewDatabase()) {
    // The in-memory preview adapter cannot evaluate DISTINCT or SQL functions.
    // Its process-local data is small; use the same filters and deduplicate here.
    const rows = await db.select({ number: orders.referenceCode }).from(orders).where(matchingRentals);
    const numbers = rows.map((row) => row.number?.replace(/[^0-9]/g, ""));
    return new Set(numbers.filter((number): number is string => Boolean(number))).size;
  }

  // A supplier may format the same number with a plus, spaces or dashes.
  // Normalize to digits before deduplication, and exclude blank/non-number rows.
  const normalizedNumber = sql<string>`regexp_replace(${orders.referenceCode}, '[^0-9]', '', 'g')`;
  const [result] = await db
    .select({ value: countDistinct(normalizedNumber) })
    .from(orders)
    .where(and(matchingRentals, sql`${normalizedNumber} <> ''`));
  return Number(result?.value ?? 0);
}
