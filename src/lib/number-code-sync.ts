import "server-only";

import { and, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { getBitcallOtpActivation } from "@/lib/bitcall";
import { checkFleexaSms } from "@/lib/fleexa";
import { logger } from "@/lib/logger";
import { NUMBER_PROVIDERS } from "@/lib/order-providers";
import { SINGLE_NUMBER_WINDOW } from "@/lib/refund-policy";
import { SERVICE_TIMEOUTS } from "@/lib/service-timeouts";

/**
 * Reading a number's code, and sweeping for ones nobody is watching.
 *
 * A code only arrived if the customer happened to have the order page open: the
 * page polls, the server has no clock of its own. Close the tab and the code sat
 * upstream until the auto-refund gave the money back — we then paid a supplier
 * for a number the customer never used, and recovering the cost depended on an
 * upstream cancel that can be refused.
 *
 * So the same read the order page performs is now also performed by the nightly
 * job, over the orders that are still inside their delivery window. One function
 * does both, because two copies of "did a code arrive" is how a page and a sweep
 * start disagreeing about the same supplier.
 */

export type NumberCodeRead = {
  code: string | null;
  message: string | null;
  /** `delivered` once a code exists; `cancelled`/`expired` when it never will. */
  status: "delivered" | "cancelled" | "expired" | "pending";
};

/**
 * Both suppliers describe delivery differently — one answers `received`, the
 * other `delivered`, and a code is the only thing that means the same on both.
 */
function normalise(status: string | null, hasCode: boolean): NumberCodeRead["status"] {
  const value = (status ?? "").toLowerCase();
  if (hasCode || value === "delivered" || value === "received" || value === "completed") return "delivered";
  if (value === "cancelled" || value === "canceled" || value === "refunded") return "cancelled";
  if (value === "expired") return "expired";
  return "pending";
}

/** One supplier read. Throws when the supplier cannot be asked right now. */
export async function readNumberCode(order: {
  provider: string;
  providerRequestId: string | null;
}): Promise<NumberCodeRead> {
  const reference = order.providerRequestId;
  if (!reference) return { code: null, message: null, status: "pending" };

  if (order.provider === "bitcall") {
    const activation = await getBitcallOtpActivation(reference);
    return {
      code: activation.code,
      // An activation reports a code, not a message body. Echoing supplier prose
      // onto the order page is how a customer learns who we buy from.
      message: null,
      status: normalise(activation.status, Boolean(activation.code)),
    };
  }

  const result = await checkFleexaSms(reference);
  return {
    code: result.code,
    message: result.message,
    status: normalise(result.status, Boolean(result.code)),
  };
}

/**
 * Finish number orders that delivered after everyone stopped looking.
 *
 * Scoped to single-verification numbers still inside their delivery window: an
 * order older than that is the auto-refund's business, and a rental receives more
 * than one code so "the" code is not a question with one answer.
 */
export async function sweepPendingNumberCodes(
  limit = 25,
): Promise<{ checked: number; delivered: number; pending: number; failed: number }> {
  const cutoff = new Date(Date.now() - SERVICE_TIMEOUTS.numbers.delivery);
  const candidates = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.status, "active"),
        eq(orders.service, "numbers"),
        eq(orders.duration, SINGLE_NUMBER_WINDOW),
        isNull(orders.otpCode),
        isNull(orders.refundedAt),
        isNotNull(orders.providerRequestId),
        inArray(orders.provider, [...NUMBER_PROVIDERS]),
        gte(orders.createdAt, cutoff),
      ),
    )
    .limit(limit);

  const result = { checked: candidates.length, delivered: 0, pending: 0, failed: 0 };

  for (const order of candidates) {
    try {
      const read = await readNumberCode(order);
      if (!read.code) {
        result.pending++;
        continue;
      }

      // Guarded exactly like the page's sync: a refund or a newer poll may have
      // landed while the supplier was being asked, and neither may be undone.
      const [saved] = await db
        .update(orders)
        .set({ otpCode: read.code, status: "delivered" })
        .where(
          and(
            eq(orders.id, order.id),
            eq(orders.status, "active"),
            isNull(orders.refundedAt),
            isNull(orders.otpCode),
          ),
        )
        .returning();

      if (saved) result.delivered++;
      else result.pending++;
    } catch (error) {
      result.failed++;
      logger.warn("Number code sweep could not read an order", {
        orderId: order.id,
        provider: order.provider,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
