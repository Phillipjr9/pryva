import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { RECONCILIATION_NOTE } from "@/lib/refund-policy";

/**
 * Record that an order needs a human to finish reconciling it.
 *
 * Kept in its own server-only module on purpose: refund-policy is imported by
 * pages and components, and pulling the database into it would break the build
 * the moment a client component wanted the shared wording.
 *
 * Bookkeeping must never mask a refund that already committed, so a failure here
 * is logged and swallowed rather than thrown.
 */
export async function flagReconciliation(orderId: string): Promise<void> {
  try {
    await db
      .update(orders)
      .set({ reconciliationNote: RECONCILIATION_NOTE })
      .where(eq(orders.id, orderId));
  } catch (error) {
    console.error("Failed to record a reconciliation note", {
      orderId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
