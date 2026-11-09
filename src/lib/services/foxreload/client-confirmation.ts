import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { foxreloadQuotes, orders, users } from "@/db/schema";
import { FOXRELOAD_PROVIDER } from "@/lib/services/order-providers";
import { FoxreloadError, isFoxreloadConfigured, readFoxreloadContractOrder, submitFoxreloadClientCode } from "@/lib/providers/foxreload";
import { verifyTopupProviderOrder } from "./topup-orders";
import { verifyStarsProviderOrder } from "./stars-orders";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const enabled = () => process.env.FOXRELOAD_CLIENT_CODES_ENABLED === "true" && isFoxreloadConfigured();
type Waiting = { kind: "waiting"; orderId: string; quoteId: string; providerId: string; itemId: string };
type Inspection = Waiting | { kind: "unavailable" | "not-found" | "not-needed" | "blocked" };

/** Read a fresh supplier order and compare the complete durable purchase intent.
 * No recipient data, supplier identifiers or codes are returned to the browser. */
export async function inspectClientConfirmation(userId: string, orderId: string): Promise<Inspection> {
  if (!UUID.test(orderId)) return { kind: "not-found" };
  if (!enabled()) return { kind: "unavailable" };
  const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, userId), eq(orders.provider, FOXRELOAD_PROVIDER), eq(orders.service, "subscriptions"), inArray(orders.productSlug, ["direct-topup", "login-topup", "telegram-stars"]), isNull(orders.refundedAt))).limit(1);
  if (!order) return { kind: "not-found" };
  if (order.status !== "review" || !order.providerRequestId || !order.requestIntent || !order.requestId) return { kind: "not-needed" };
  const [quote] = await db.select().from(foxreloadQuotes).where(and(eq(foxreloadQuotes.orderId, order.id), eq(foxreloadQuotes.userId, userId))).limit(1);
  if (!quote) return { kind: "not-needed" };
  if (quote.clientCodeState) return { kind: "blocked" };
  const raw = await readFoxreloadContractOrder(order.providerRequestId).catch(() => null);
  const expected = { id: order.providerRequestId, total: quote.wholesaleTotal, quantity: quote.quantity, requestId: order.id };
  const verified = order.productSlug !== "telegram-stars"
    ? verifyTopupProviderOrder(raw, { ...expected, productId: quote.productId, userId, quoteId: quote.id, intent: order.requestIntent, deliveryType: order.productSlug === "login-topup" ? "login_topup" : "direct_topup" })
    : verifyStarsProviderOrder(raw, { ...expected, quoteId: quote.id, recipientIntent: order.requestIntent });
  if (!verified || !raw || typeof raw !== "object" || Array.isArray(raw)) return { kind: "not-needed" };
  const supplier = raw as Record<string, unknown>;
  const item = Array.isArray(supplier.items) ? supplier.items[0] as Record<string, unknown> | null : null;
  if (supplier.status !== "action_required" || !item || item.fulfillmentStatus !== "action_required" || typeof item.id !== "string" || !UUID.test(item.id)) return { kind: "not-needed" };
  return { kind: "waiting", orderId: order.id, quoteId: quote.id, providerId: verified.id, itemId: item.id };
}

class ClaimLost extends Error {}
/** Single durable claim before network I/O. Ambiguous submissions stay blocked;
 * only the provider's explicit rejected-code response permits a fresh code. */
export async function submitClientConfirmation(userId: string, orderId: string, input: string): Promise<"submitted" | "rejected" | "uncertain" | "unavailable"> {
  const code = input.trim();
  if (!/^[A-Za-z0-9 ._-]{1,255}$/.test(code)) return "unavailable";
  const waiting = await inspectClientConfirmation(userId, orderId);
  if (waiting.kind !== "waiting") return "unavailable";
  try {
    await db.transaction(async (tx) => {
      const [account] = await tx.select({ suspendedAt: users.suspendedAt, deletedAt: users.deletedAt }).from(users).where(eq(users.id, userId)).for("update").limit(1);
      if (!account || account.suspendedAt || account.deletedAt) throw new ClaimLost();
      const [claimedOrder] = await tx.update(orders).set({ status: "processing", reconciliationNote: "Customer confirmation is being submitted; verify before refund." }).where(and(eq(orders.id, orderId), eq(orders.userId, userId), eq(orders.status, "review"), eq(orders.providerRequestId, waiting.providerId), isNull(orders.refundedAt))).returning({ id: orders.id });
      if (!claimedOrder) throw new ClaimLost();
      const [claim] = await tx.update(foxreloadQuotes).set({ clientCodeState: "pending" }).where(and(eq(foxreloadQuotes.id, waiting.quoteId), eq(foxreloadQuotes.orderId, orderId), eq(foxreloadQuotes.userId, userId), isNull(foxreloadQuotes.clientCodeState))).returning({ id: foxreloadQuotes.id });
      if (!claim) throw new ClaimLost();
    });
  } catch (error) { if (error instanceof ClaimLost) return "unavailable"; throw error; }
  let outcome: "submitted" | "rejected" | "uncertain";
  try {
    await submitFoxreloadClientCode(waiting.providerId, waiting.itemId, code);
    outcome = "submitted";
  } catch (error) {
    outcome = error instanceof FoxreloadError && error.status === 400 && error.code === "ORDER_ITEM_CLIENT_CODE_REJECTED" ? "rejected" : "uncertain";
  }
  await db.transaction(async (tx) => {
    await tx.update(foxreloadQuotes).set({ clientCodeState: outcome === "rejected" ? null : outcome }).where(and(eq(foxreloadQuotes.id, waiting.quoteId), eq(foxreloadQuotes.orderId, orderId), eq(foxreloadQuotes.clientCodeState, "pending")));
    await tx.update(orders).set({ status: "review", reconciliationNote: outcome === "rejected" ? "Confirmation rejected; a fresh code may be submitted." : outcome === "submitted" ? "Confirmation submitted; awaiting verified delivery." : "Confirmation outcome uncertain; reconcile before retry or refund." }).where(and(eq(orders.id, orderId), eq(orders.userId, userId), eq(orders.status, "processing"), eq(orders.providerRequestId, waiting.providerId), isNull(orders.refundedAt)));
  });
  return outcome;
}
