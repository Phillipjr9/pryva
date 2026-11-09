import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { orders, users, type Order } from "@/db/schema";
import { SMM_PROVIDER } from "@/lib/services/order-providers";
import { findBoostListing } from "@/lib/services/boosts/smm-catalog";
import { addSmmOrder, isSmmPanelConfigured } from "@/lib/providers/smm-panel";
import { scheduleWalletEmails } from "@/lib/email/schedule-wallet-emails";
import { totalForQuantity } from "@/lib/services/boosts/smm-pricing";
import { debitWalletInTx, InsufficientFundsError, makeReference } from "@/lib/payments/wallet";

/** A debit and durable review claim precede the non-idempotent supplier call.
 * Ambiguous outcomes are never automatically refunded or retried. */
export type BoostOrderResult =
  | { kind: "created"; order: Order; balance: number }
  | { kind: "replay"; order: Order }
  | { kind: "pending"; orderId: string; reference: string }
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
  const matches = (row: Order) => row.service === "social" && row.provider === SMM_PROVIDER &&
    row.productSlug === input.itemId && row.targetLink === input.link && row.quantity === input.quantity;
  const replay = (row: Order): BoostOrderResult => matches(row)
    ? { kind: "replay", order: row }
    : { kind: "invalid", error: "This request belongs to a different order. Check your orders before trying again." };

  // Replays work even if the provider or catalogue is currently unavailable.
  const [existing] = await db.select().from(orders)
    .where(and(eq(orders.userId, input.userId), eq(orders.requestId, input.requestId))).limit(1);
  if (existing) return replay(existing);
  if (!isSmmPanelConfigured()) return { kind: "disabled", error: DISABLED };
  const found = await findBoostListing(input.itemId).catch(() => null);
  if (!found) return { kind: "invalid", error: "That boosting service is no longer available." };
  const { listing } = found;
  const problem = quantityProblem(input.quantity, listing.min, listing.max);
  if (problem) return { kind: "invalid", error: problem };
  if (listing.perThousand === null) return { kind: "unavailable", error: "This boosting service is not available right now." };
  const total = totalForQuantity(listing.perThousand, input.quantity);
  if (total <= 0) return { kind: "unavailable", error: "This boosting service is not available right now." };

  const reference = makeReference("PRY");
  const orderId = randomUUID();
  const planLabel = `${input.quantity.toLocaleString("en-NG")} ${listing.tag.toLowerCase()}`;

  let balance: number;
  try {
    balance = await db.transaction(async (tx: any) => {
      // Serialize new attempts for this account and block another purchase
      // while any earlier SMM result is unresolved, even after a browser reload.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.userId}))`);
      const [raced] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.userId, input.userId), eq(orders.requestId, input.requestId)))
        .limit(1);
      if (raced) throw new ReplaySignal(raced);
      const [unresolved] = await tx.select().from(orders).where(and(
        eq(orders.userId, input.userId), eq(orders.provider, SMM_PROVIDER),
        or(eq(orders.status, "processing"), eq(orders.status, "review")), isNull(orders.refundedAt),
      )).limit(1);
      if (unresolved) throw new PendingSignal(unresolved.id, unresolved.reference);

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
        status: "review",
        reconciliationNote: "Boost order claimed before provider call; outcome requires tracking.",
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
    if (error instanceof ReplaySignal) return replay(error.order);
    if (error instanceof PendingSignal) return { kind: "pending", orderId: error.orderId, reference: error.reference };
    if (error instanceof InsufficientFundsError) {
      return { kind: "insufficient", balance: error.balance, required: error.required };
    }
    if (isUniqueViolation(error)) {
      const [winner] = await db
        .select()
        .from(orders)
        .where(and(eq(orders.userId, input.userId), eq(orders.requestId, input.requestId)))
        .limit(1);
      if (winner) return replay(winner);
    }
    throw error;
  }

  // The debit committed with the claim. Nudge the receipt even if the supplier
  // never answers; no path below can infer a refund from a missing response.
  scheduleWalletEmails();
  let providerOrderId: string | null = null;
  try {
    const eligible = await db.transaction(async (tx) => {
      const [account] = await tx.select({ suspendedAt: users.suspendedAt, deletedAt: users.deletedAt })
        .from(users).where(eq(users.id, input.userId)).for("update").limit(1);
      if (!account || account.suspendedAt || account.deletedAt) return false;
      const [claim] = await tx.update(orders).set({ reconciliationNote: "Boost provider purchase started; outcome requires reconciliation." })
        .where(and(eq(orders.id, orderId), eq(orders.status, "review"), isNull(orders.refundedAt))).returning({ id: orders.id });
      if (!claim) throw new Error("Boost claim unavailable");
      return true;
    });
    if (!eligible) {
      await db.update(orders).set({ reconciliationNote: "Account unavailable before supplier call; debit requires reconciliation." })
        .where(and(eq(orders.id, orderId), eq(orders.status, "review"), isNull(orders.refundedAt)));
      return { kind: "pending", orderId, reference };
    }
    const placement = await addSmmOrder({ service: listing.serviceId, link: input.link, quantity: input.quantity });
    providerOrderId = placement.orderId;
    const [updated] = await db.update(orders)
      .set({ status: "active", providerRequestId: providerOrderId, reconciliationNote: null })
      .where(and(eq(orders.id, orderId), eq(orders.status, "review"), isNull(orders.refundedAt)))
      .returning();
    if (!updated) return { kind: "pending", orderId, reference };
    return { kind: "created", order: updated, balance };
  } catch {
    // Supplier failures, missing responses, and failed database commits are all
    // ambiguous. Preserve any known provider id, never auto-refund or retry.
    try {
      await db.update(orders).set({
        ...(providerOrderId ? { providerRequestId: providerOrderId } : {}),
        reconciliationNote: "Boost purchase outcome requires supplier and wallet reconciliation; no automatic refund issued.",
      }).where(and(eq(orders.id, orderId), eq(orders.status, "review"), isNull(orders.refundedAt)));
    } catch { /* The original durable review claim remains for an operator. */ }
    return { kind: "pending", orderId, reference };
  }
}

/** Thrown inside the transaction when a concurrent attempt already committed. */
class ReplaySignal extends Error {
  constructor(public readonly order: Order) {
    super("replay");
    this.name = "ReplaySignal";
  }
}

class PendingSignal extends Error {
  constructor(public readonly orderId: string, public readonly reference: string) { super("Previous boost needs review"); }
}
