import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { orders, type Order } from "@/db/schema";
import { SMM_PROVIDER } from "@/lib/services/order-providers";
import { findBoostListing } from "@/lib/services/boosts/smm-catalog";
import { addSmmOrder, isSmmPanelConfigured, SmmPanelError } from "@/lib/providers/smm-panel";
import { scheduleWalletEmails } from "@/lib/email/schedule-wallet-emails";
import { MAX_BOOST_AMOUNT_NGN, MAX_BOOST_QUANTITY, totalForQuantity } from "@/lib/services/boosts/boost-money";
import { publicBoostQuote } from "@/lib/services/boosts/boost-quote";
import { creditWalletInTx, debitWalletInTx, InsufficientFundsError, makeReference } from "@/lib/payments/wallet";

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
 * called exactly once. If placement fails, an automatic refund is attempted and
 * the wallet credit and order status commit together. An unconfirmed refund needs
 * review. If the process dies between the debit and the panel call, the order sits
 * at `processing` with no supplier reference, which
 * is a state an operator can see and settle; charging after an un-repeatable
 * call would instead leave a paid-for nothing.
 */

export type BoostOrderResult =
  | { kind: "created"; order: Order; balance: number }
  | { kind: "replay"; order: Order }
  | { kind: "invalid"; error: string }
  | { kind: "quote_required"; error: string }
  | { kind: "quote_changed"; error: string; quote: NonNullable<ReturnType<typeof publicBoostQuote>> }
  | { kind: "request_conflict"; error: string }
  | { kind: "unavailable"; error: string; outcome?: "refunded" | "unconfirmed" }
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
  if (quantity > MAX_BOOST_QUANTITY) return "That quantity is too large.";
  return null;
}

/** Shown when boosting has no live supplier behind it, so no order can exist. */
const DISABLED = "Boosting is unavailable right now. If you already submitted an order, check your orders and wallet.";

type BoostOrderInput = {
  userId: string;
  itemId: string;
  link: string;
  quantity: number;
  /** Client-supplied, stable across a retry of the same attempt. */
  requestId: string;
  /** A review comparison, never the price the server charges. */
  expectedTotalNgn?: unknown;
  expectedTerms?: unknown;
};

function replayResult(order: Order, input: BoostOrderInput): BoostOrderResult {
  if (order.service !== "social" || order.productSlug !== input.itemId ||
      order.quantity !== input.quantity || order.targetLink !== input.link) {
    return { kind: "request_conflict", error: "This request belongs to a different purchase. Check your orders before starting another." };
  }
  return { kind: "replay", order };
}

async function existingBoostOrder(input: BoostOrderInput): Promise<Order | undefined> {
  const [existing] = await db.select().from(orders)
    .where(and(eq(orders.userId, input.userId), eq(orders.requestId, input.requestId)))
    .limit(1);
  return existing;
}

export async function placeBoostOrder(input: BoostOrderInput): Promise<BoostOrderResult> {
  // An already submitted attempt must remain readable even if the catalog,
  // price or provider has since become unavailable, or an old client retries.
  const existing = await existingBoostOrder(input);
  if (existing) return replayResult(existing, input);

  if (typeof input.expectedTotalNgn !== "number" || !Number.isSafeInteger(input.expectedTotalNgn) ||
      input.expectedTotalNgn <= 0 || input.expectedTotalNgn > MAX_BOOST_AMOUNT_NGN ||
      typeof input.expectedTerms !== "string" || !/^[a-f0-9]{24}$/.test(input.expectedTerms)) {
    return { kind: "quote_required", error: "Review the current price before ordering. Refresh the page if needed." };
  }
  if (!isSmmPanelConfigured()) return { kind: "disabled", error: DISABLED };
  // The catalog read can fail on its own (unreachable panel, corrupt snapshot).
  // That is not the customer's fault and must never surface as a 500.
  const found = await findBoostListing(input.itemId).catch(() => null);
  if (!found) return { kind: "invalid", error: "That boosting service is no longer available." };
  const { listing } = found;

  const quote = publicBoostQuote(listing);
  if (!quote) return { kind: "unavailable", error: "This boosting service is not available right now." };
  const changedQuote = async (): Promise<BoostOrderResult> => {
    // A concurrent submission may have committed while the catalog was read.
    // A missing row does not prove that another submission is not still in flight.
    const winner = await existingBoostOrder(input);
    if (winner) return replayResult(winner, input);
    return { kind: "quote_changed", error: "The price or service details changed. Review the updated total before confirming.", quote };
  };
  if (input.expectedTerms !== quote.terms) return changedQuote();

  const problem = quantityProblem(input.quantity, quote.min, quote.max);
  if (problem) return { kind: "invalid", error: problem };
  const total = totalForQuantity(quote.perThousand, input.quantity);
  if (total <= 0) return { kind: "invalid", error: "This amount cannot be ordered. Try a smaller quantity." };
  if (input.expectedTotalNgn !== total) return changedQuote();

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
        provider: SMM_PROVIDER,
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
    if (error instanceof ReplaySignal) return replayResult(error.order, input);
    if (error instanceof InsufficientFundsError) {
      return { kind: "insufficient", balance: error.balance, required: error.required };
    }
    if (isUniqueViolation(error)) {
      const [winner] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.userId, input.userId), eq(orders.requestId, input.requestId)))
        .limit(1);
      if (winner) return replayResult(winner, input);
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
    scheduleWalletEmails();
    return { kind: "created", order: updated ?? ({ id: orderId } as Order), balance };
  } catch (error) {
    // The supplier or the following order write failed. This does not prove
    // whether the supplier accepted the order; avoid promising it did not start.
    const reason =
      error instanceof SmmPanelError
        ? `Supplier request failed (${error.code ?? error.status})`
        : "Boost placement or order update could not be confirmed";
    let refunded = false;
    try {
      // One transaction, the same way the purchase above commits its charge and
      // its row: the money going back and the order saying it went back are one
      // event. Written separately, the credit could commit and the status write
      // then fail, leaving a wallet the customer had been refunded into and an
      // order — plus a note below — insisting the refund had not happened.
      await db.transaction(async (tx: any) => {
        // The claim is the first write and it repeats the guard against the row:
        // only an order that has not already been refunded may add money to a
        // balance. A declined claim rolls the whole thing back.
        const [claimable] = await tx
          .update(orders)
          .set({ status: "refunded", refundedAt: new Date(), reconciliationNote: reason })
          .where(and(eq(orders.id, orderId), isNull(orders.refundedAt)))
          .returning({ id: orders.id });
        if (!claimable) throw new Error("Boost order was already settled");

        await creditWalletInTx(tx, {
          userId: input.userId,
          amount: total,
          type: "refund",
          description: `Refund · ${listing.name} · ${planLabel}`,
          orderId,
          reference: makeReference("RFB"),
        });
      });
      refunded = true;
    } catch (refundError) {
      // A transaction error may mean the commit acknowledgement was lost.
      // Preserve an already-committed refund and make the uncertain case visible.
      console.error("Boost refund could not be confirmed", refundError);
      try {
        await db
          .update(orders)
          .set({ reconciliationNote: `${reason}; automatic refund could not be confirmed` })
          .where(and(eq(orders.id, orderId), isNull(orders.refundedAt)));
      } catch (noteError) {
        console.error("Could not flag boost order for review", noteError);
      }
    }
    if (refunded) scheduleWalletEmails();
    return {
      kind: "unavailable",
      outcome: refunded ? "refunded" : "unconfirmed",
      error: refunded
        ? "We couldn't confirm your boost. Your wallet has been refunded. Check your orders or contact support before placing another order."
        : "We couldn't confirm your boost or its refund. Check your orders and wallet, then contact support before placing another order.",
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
