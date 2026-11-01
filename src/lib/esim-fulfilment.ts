import "server-only";

import { and, eq, isNull, lt } from "drizzle-orm";

import { db } from "@/db";
import { orders, type Order } from "@/db/schema";
import type { EsimOffer } from "@/lib/esim-catalog";
import {
  buyBitcallEsimPlan,
  getBitcallEsimOrder,
  getBitcallEsimProfile,
  isAmbiguousBitcallOutcome,
  type BitcallEsimOrder,
} from "@/lib/bitcall";
import { logger } from "@/lib/logger";
import { ESIM_PROVIDER } from "@/lib/order-providers";
import { debitWalletInTx, InsufficientFundsError } from "@/lib/wallet";

/**
 * Buying and delivering an eSIM.
 *
 * Two properties of the supplier shape this module:
 *
 *   * a purchase spends real balance on **every** call and carries no
 *     idempotency key, so a failed or timed-out call must never simply be
 *     retried — `isAmbiguousBitcallOutcome` decides whether we know nothing
 *     happened;
 *   * the order provisions asynchronously, so a purchase can be paid for before
 *     there is anything to hand over.
 *
 * Consequently an eSIM order is only charged once its activation material is in
 * hand. An order still provisioning is recorded as `processing` and costs the
 * customer nothing until it is completed — either moments later in the same
 * request, or by the completion endpoint / nightly sweep afterwards.
 */

/** How long a single request waits for a profile before returning "provisioning". */
const POLL_INTERVAL_MS = 2_500;
export const ESIM_POLL_BUDGET_MS = 22_000;

/** A pending order older than this is not going to deliver itself. */
export const ESIM_PENDING_TIMEOUT_MS = 30 * 60 * 1000;

export type EsimDelivery = {
  provider: typeof ESIM_PROVIDER;
  providerRequestId: string;
  iccid: string;
  activationCode: string;
  installUrl: string | null;
};

export type EsimPurchaseOutcome =
  | { kind: "delivered"; delivery: EsimDelivery }
  | { kind: "pending"; providerRequestId: string }
  /** The supplier definitely refused; nothing was bought. */
  | { kind: "refused"; message: string }
  /** The supplier may have bought it. Never retried — a human reconciles it. */
  | { kind: "unknown"; message: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type EsimRow = Pick<Order, "id" | "status" | "providerRequestId" | "esimIccid">;

function terminal(status: BitcallEsimOrder["status"]): boolean {
  return ["failed", "cancelled", "refunded", "refund_pending", "requires_review"].includes(status);
}

/**
 * Read the profile for an order that has reported an ICCID.
 *
 * A missing activation code is not a delivery: without it the customer cannot
 * install anything, so it is treated as "still provisioning".
 */
async function activationFor(order: BitcallEsimOrder): Promise<EsimDelivery | null> {
  const iccid = order.iccids[0];
  if (!iccid) return null;
  const profile = await getBitcallEsimProfile(iccid);
  if (!profile.activationCode) return null;
  return {
    provider: ESIM_PROVIDER,
    providerRequestId: order.orderId ?? "",
    iccid: profile.iccid || iccid,
    activationCode: profile.activationCode,
    installUrl: profile.appleInstallUrl ?? null,
  };
}

/** Poll one provider order until its profile is readable, or the budget runs out. */
export async function waitForEsimDelivery(providerOrderId: string, budgetMs = ESIM_POLL_BUDGET_MS): Promise<EsimDelivery | "pending" | "refused"> {
  const deadline = Date.now() + budgetMs;
  let order: BitcallEsimOrder | null = null;
  do {
    try {
      order = await getBitcallEsimOrder(providerOrderId);
    } catch (error) {
      // Reading back is free and safe to retry; a read failure says nothing
      // about the purchase.
      logger.warn("eSIM order read failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (order && order.status === "delivered") {
      const delivery = await activationFor(order);
      if (delivery) return delivery;
    }
    if (order && terminal(order.status)) return "refused";
    if (Date.now() >= deadline) break;
    await sleep(POLL_INTERVAL_MS);
  } while (Date.now() < deadline);
  return "pending";
}

/**
 * Buy a plan and try to deliver it inside this request.
 *
 * Nothing is charged here: the caller records and charges once it knows what
 * happened, so a crash between the purchase and the record cannot take money for
 * a profile nobody received.
 */
export async function purchaseEsim(offer: EsimOffer): Promise<EsimPurchaseOutcome> {
  let bought: BitcallEsimOrder;
  try {
    bought = await buyBitcallEsimPlan(offer.planId);
  } catch (error) {
    if (isAmbiguousBitcallOutcome(error)) {
      logger.error("eSIM purchase outcome unknown", {
        offerId: offer.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return { kind: "unknown", message: "The outcome of this purchase is unknown." };
    }
    return { kind: "refused", message: "The eSIM supplier did not accept that plan." };
  }

  if (!bought.orderId) {
    logger.error("eSIM purchase returned no order reference", { offerId: offer.id });
    return { kind: "unknown", message: "The supplier accepted the purchase without an order reference." };
  }

  if (bought.status === "delivered") {
    const delivery = await activationFor(bought).catch(() => null);
    if (delivery) return { kind: "delivered", delivery: { ...delivery, providerRequestId: bought.orderId! } };
  }
  if (terminal(bought.status)) return { kind: "refused", message: "The eSIM supplier cancelled that purchase." };

  const result = await waitForEsimDelivery(bought.orderId);
  if (result === "refused") return { kind: "refused", message: "The eSIM supplier cancelled that purchase." };
  if (result === "pending") return { kind: "pending", providerRequestId: bought.orderId };
  return { kind: "delivered", delivery: { ...result, providerRequestId: bought.orderId } };
}

export type Completion =
  | { kind: "delivered"; order: Order; balance: number }
  | { kind: "pending" }
  | { kind: "refused"; order: Order }
  | { kind: "unpaid"; order: Order };

/**
 * Finish a `processing` eSIM order: read the profile, then record and charge in
 * one transaction.
 *
 * Only the transition from `processing` completes an order, and the update is
 * repeated as a condition inside the transaction, so two concurrent page loads
 * cannot charge the same order twice.
 */
export async function completeEsimOrder(row: EsimRow): Promise<Completion> {
  if (row.status !== "processing" || !row.providerRequestId) return { kind: "pending" };

  const result = await waitForEsimDelivery(row.providerRequestId, 8_000);
  if (result === "pending") {
    // Too old and still not delivered: leave it visible to an operator rather
    // than polling forever.
    if (await expireStale(row)) return { kind: "refused", order: (await reload(row.id))! };
    return { kind: "pending" };
  }

  if (result === "refused") {
    const [failed] = await db
      .update(orders)
      .set({ status: "review", reconciliationNote: "Supplier did not deliver this eSIM purchase." })
      .where(and(eq(orders.id, row.id), eq(orders.status, "processing")))
      .returning();
    return { kind: "refused", order: failed ?? (await reload(row.id))! };
  }

  let claimed: { order: Order; balance: number } | null = null;
  try {
    claimed = await db.transaction(async (tx): Promise<{ order: Order; balance: number }> => {
      const [order] = await tx
        .update(orders)
        .set({
          status: "active",
          referenceCode: result.iccid,
          esimIccid: result.iccid,
          esimActivationCode: result.activationCode,
          esimInstallUrl: result.installUrl,
        })
        .where(and(eq(orders.id, row.id), eq(orders.status, "processing")))
        .returning();
      if (!order) throw new AlreadyCompleted();

      const balance = await debitWalletInTx(tx, {
        userId: order.userId,
        amount: order.amount,
        type: "debit",
        description: `${order.productName} · ${order.planLabel}`,
        orderId: order.id,
        reference: order.reference,
      });
      return { order, balance };
    });
  } catch (error) {
    if (error instanceof AlreadyCompleted) return { kind: "pending" };
    if (error instanceof InsufficientFundsError) {
      const [unpaid] = await db
        .update(orders)
        .set({ status: "review", reconciliationNote: "Balance no longer covers this eSIM at delivery time." })
        .where(and(eq(orders.id, row.id), eq(orders.status, "processing")))
        .returning();
      return { kind: "unpaid", order: unpaid ?? (await reload(row.id))! };
    }
    throw error;
  }

  return { kind: "delivered", order: claimed.order, balance: claimed.balance };
}

class AlreadyCompleted extends Error {}

async function reload(id: string): Promise<Order | null> {
  const [row] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  return row ?? null;
}

/** Move a long-stale pending order to review; it was bought but never delivered. */
async function expireStale(row: EsimRow): Promise<boolean> {
  const cutoff = new Date(Date.now() - ESIM_PENDING_TIMEOUT_MS);
  const [moved] = await db
    .update(orders)
    .set({ status: "review", reconciliationNote: "eSIM was bought but no profile arrived; nothing was charged." })
    .where(and(eq(orders.id, row.id), eq(orders.status, "processing"), lt(orders.createdAt, cutoff)))
    .returning();
  return Boolean(moved);
}

/**
 * Nightly sweep for orders that provisioned after the customer left.
 *
 * Today's numbers only: a handful of pending eSIM orders, each a single read.
 */
export async function sweepPendingEsimOrders(limit = 25): Promise<{ completed: number; pending: number; failed: number }> {
  const pending = await db
    .select({ id: orders.id, status: orders.status, providerRequestId: orders.providerRequestId, esimIccid: orders.esimIccid })
    .from(orders)
    .where(
      and(
        eq(orders.service, "esim"),
        eq(orders.status, "processing"),
        eq(orders.provider, ESIM_PROVIDER),
        isNull(orders.esimActivationCode),
      ),
    )
    .limit(limit);

  const result = { completed: 0, pending: 0, failed: 0 };
  for (const row of pending) {
    try {
      const completion = await completeEsimOrder(row);
      if (completion.kind === "delivered") result.completed++;
      else result.pending++;
    } catch (error) {
      logger.error("eSIM sweep failed for order", {
        orderId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
      result.failed++;
    }
  }
  return result;
}
