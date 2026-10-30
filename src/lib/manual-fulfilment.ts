import "server-only";
import { isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { isConfiguredAdminEmail } from "@/lib/auth";

/**
 * Scan cap. We only need to know whether *someone* qualifies, not enumerate
 * them, and the allowlist is matched in JS rather than in SQL so that
 * `isConfiguredAdminEmail` stays the single source of truth for what an
 * allowlisted address means (it lowercases both sides; an `inArray` on the raw
 * env value would miss a mixed-case row).
 */
const VERIFIED_SCAN_LIMIT = 500;

/**
 * Whether anyone can actually reach the queue that prepares a hand-sourced order.
 *
 * `/admin/fulfilment` is the only path that delivers a manual-lane product, and
 * `requireAdmin` accepts a user only with BOTH a verified address and an
 * allowlisted one (`isAdminUser`). Verification is delivered by email, so while
 * transactional email is unconfigured `emailVerifiedAt` is never set, no user
 * qualifies, and the queue is unreachable.
 *
 * That combination is sellable-but-undeliverable, and it is reachable by
 * accident rather than by decision: the marketplace pause gate
 * (`isMarketplacePurchaseEnabled`) switches on the moment a supplier key exists,
 * and the purchase route checks that gate BEFORE it branches on whether the slug
 * is hand-sourced. So setting one supplier key enables checkout for the manual
 * catalog too — orders recorded `provider: "manual"`, `status: "processing"`,
 * waiting on a queue nobody can open.
 *
 * This is the check that keeps taking money for those items conditional on
 * someone being able to prepare them. Same principle as gating a plan's CTA on
 * `isPlanFulfillable`: do not accept payment for something the system cannot
 * deliver, however honestly the listing describes it.
 *
 * **Fails closed.** If the question cannot be answered, the answer is no —
 * pausing a listing is recoverable, selling something nobody can deliver is not.
 */
export async function isManualFulfilmentReachable(): Promise<boolean> {
  try {
    const rows = await db
      .select({ email: users.email })
      .from(users)
      .where(isNotNull(users.emailVerifiedAt))
      .limit(VERIFIED_SCAN_LIMIT);
    return rows.some((row) => typeof row.email === "string" && isConfiguredAdminEmail(row.email));
  } catch {
    return false;
  }
}
