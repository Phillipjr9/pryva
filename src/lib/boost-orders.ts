import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { orders, type Order } from "@/db/schema";
import { findBoostListing } from "@/lib/smm-catalog";
import { addSmmOrder, isSmmPanelConfigured, SmmPanelError } from "@/lib/smm-panel";
import { totalForQuantity } from "@/lib/smm-pricing";
import { creditWallet, debitWalletInTx, InsufficientFundsError, makeReference } from "@/lib/wallet";

/**
 * Buying a boost.
 *
 * The order matters here, and it is the opposite of the catalogue purchase path
 * on purpose. For a number, fulfilment comes first and the wallet is charged
 * only once a working unit exists, because the supplier can release it again if
 * the charge fails. A boosting panel offers neither of those things:
 *
 *   • **No idempotency key.** `add` is not repeatable — a retry is a second
 *     order and a second charge — so we must never call it twice for one
 *     customer action.
 *   • **No reliable release.** Some panels cancel, some do not, and a cancelled
 *     order may still have delivered part of the quantity.
 *
 * So the wallet is debited and the order recorded **first**, then the panel is
 * called exactly once. If the panel refuses, the debit is reversed in full and
 * the order is marked refunded — the customer is never out of pocket for a
 * delivery that never started. If the process dies between the debit and the
 * panel call, the order sits at `processing` with no supplier reference, which
 * is a state an operator can see and settle; charging after an un-repeatable
 * call would instead leave a paid-for nothing.
 */

export type BoostOrderResult =
  | { kind: "created"; order: Order; balance: number }
  | { kind: "replay"; order: Order }
  | { kind: "invalid"; error: string }
  | { kind: "unavailable"; error: string }
  /** Nothing is configured to fulfil this, so there is nothing to sell yet. */
  | { kind: "disabled"; error: string }
  | { kind: "insufficient"; balance: number; required: number };

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

function isUniqueViolation(error: unknown): boolean {
  return errorCode(error) === "23505";
}

/** The supplier's own bounds are the contract; refuse rather than forward. */
function quantityProblem(quantity: number, min: number | null, max: number | null): string | null {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) return "Enter how many units you want.";
  if (min !== null && quantity < min) return `The smallest order for this service is ${min.toLocaleString("en-NG")}.`;
  if (max !== null && quantity > max) return `The largest order for this service is ${max.toLocaleString("en-NG")}.`;
  if (quantity > 100_000_000) return "That quantity is too large.";
  return null;
}

/** Shown when boosting has no live supplier behind it, so no order can exist. */
const DISABLED = "Boosting is not available right now. Nothing was charged.";

export async function placeBoostOrder(input: {
  userId: string;
  itemId: string;
  link: string;
  quantity: number;
  /** Client-supplied, stable across a retry of the same attempt. */
  requestId: string;
}): Promise<BoostOrderResult> {
  if (!isSmmPanelConfigured()) return { kind: "disabled", error: DISABLED };
  // The catalog read can fail on its own (unreachable panel, corrupt snapshot).
  // That is not the customer's fault and must never surface as a 500.
  const found = await findBoostListing(input.itemId).catch(() => null);
  if (!found) return { kind: "invalid", error: "That boosting service is no longer available." };
  const { listing } = found;

  const problem = quantityProblem(input.quantity, listing.min, listing.max);
  if (problem) return { kind: "invalid", error: problem };

  if (listing.perThousand === null) {
    return { kind: "unavailable", error: "This boosting service is not available right now." };
  }
  const total = totalForQuantity(listing.perThousand, input.quantity);
  if (total <= 0) return { kind: "unavailable", error: "This boosting service is not available right now." };

  // A replay must cost nothing and buy nothing: same attempt, same order.
  const [existing] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.userId, input.userId), eq(orders.requestId, input.requestId)))
    .limit(1);
  if (existing) return { kind: "replay", order: existing };

  const reference = makeReference("PRY");
  const orderId = randomUUID();
  const planLabel = `${input.quantity.toLocaleString("en-NG")} ${listing.tag.toLowerCase()}`;

  let balance: number;
  try {
    balance = await db.transaction(async (tx: any) => {
      const [raced] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.userId, input.userId), eq(orders.requestId, input.requestId)))
        .limit(1);
      if (raced) throw new ReplaySignal(raced);

      await tx.insert(orders).values({
        id: orderId,
        reference,
        userId: input.userId,
        requestId: input.requestId,
        service: "social",
        productSlug: listing.id,
        productName: listing.name.slice(0, 160),
        planLabel: planLabel.slice(0, 120),
        region: "Not country-specific",
        duration: "Until delivered",
        amount: total,
        // Nothing has been delivered yet: this is the state that says "the
        // supplier has not confirmed", not "the customer owns this".
        status: "processing",
        provider: "smm",
        targetLink: input.link,
        quantity: input.quantity,
      });

      return debitWalletInTx(tx, {
        userId: input.userId,
        amount: total,
        type: "debit",
        description: `${listing.name} · ${planLabel}`,
        orderId,
        reference,
      });
    });
  } catch (error) {
    if (error instanceof ReplaySignal) return { kind: "replay", order: error.order };
    if (error instanceof InsufficientFundsError) {
      return { kind: "insufficient", balance: error.balance, required: error.required };
    }
    if (isUniqueViolation(error)) {
      const [winner] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.userId, input.userId), eq(orders.requestId, input.requestId)))
        .limit(1);
      if (winner) return { kind: "replay", order: winner };
    }
    throw error;
  }

  // Exactly one call. Never retried here or above: a second call is a second
  // supplier charge for the same customer action.
  try {
    const placement = await addSmmOrder({
      service: listing.serviceId,
      link: input.link,
      quantity: input.quantity,
    });
    const [updated] = await db
      .update(orders)
      .set({ status: "active", providerRequestId: placement.orderId })
      .where(eq(orders.id, orderId))
      .returning();
    return { kind: "created", order: updated ?? ({ id: orderId } as Order), balance };
  } catch (error) {
    // The supplier did not accept the order: give the money back, record why,
    // and leave the row refunded so support can see it was never delivered.
    const reason =
      error instanceof SmmPanelError
        ? `Supplier refused the order (${error.code ?? error.status})`
        : "Supplier call failed";
    try {
      await creditWallet({
        userId: input.userId,
        amount: total,
        type: "refund",
        description: `Refund · ${listing.name} · ${planLabel}`,
        orderId,
        reference: makeReference("RFB"),
      });
      await db
        .update(orders)
        .set({ status: "refunded", refundedAt: new Date(), reconciliationNote: reason })
        .where(eq(orders.id, orderId));
    } catch (refundError) {
      // The debit stands and the row stays at `processing` so an operator can
      // see it: better a visible unfulfilled order than a silent loss.
      console.error("Boost refund failed", refundError);
      await db
        .update(orders)
        .set({ reconciliationNote: `${reason}; automatic refund failed` })
        .where(eq(orders.id, orderId));
    }
    return {
      kind: "unavailable",
      error: "We couldn't start that boost, so nothing was charged. Please try again.",
    };
  }
}

/** Thrown inside the transaction when a concurrent attempt already committed. */
class ReplaySignal extends Error {
  constructor(public readonly order: Order) {
    super("replay");
    this.name = "ReplaySignal";
  }
}
