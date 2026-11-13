import "server-only";

import { and, count, eq, exists, gte, inArray, isNotNull, isNull, like, lte, notExists, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, walletTransactions } from "@/db/schema";
import { LOYALTY_LEVELS, loyaltyLevelForOrders } from "@/lib/services/loyalty-policy";
import { isPreviewDatabase } from "@/lib/platform/demo-policy";

export const LOYALTY_MINIMUM_ORDER_NGN = 500;

/** No inferred launch time: a missing or malformed instant leaves tracking off. */
export function loyaltyStartAt(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const time = new Date(value);
  return Number.isFinite(time.getTime()) && time.toISOString() === value ? time : null;
}

/**
 * Read-only progress. Counts rows, not baskets; each bulk unit must independently
 * meet the minimum and fulfilment checks. No transaction data or credentials
 * leave this function. The launch instant must be fixed across deployments.
 */
export async function readLoyaltyProgress(userId: string, now = new Date()) {
  const start = loyaltyStartAt(process.env.LOYALTY_START_AT);
  if (!start || start > now || isPreviewDatabase()) return null;

  const debit = db.select({ id: walletTransactions.id }).from(walletTransactions).where(and(
    eq(walletTransactions.orderId, orders.id), eq(walletTransactions.userId, orders.userId),
    eq(walletTransactions.type, "debit"), eq(walletTransactions.amount, orders.amount),
  ));
  const refund = db.select({ id: walletTransactions.id }).from(walletTransactions).where(and(
    eq(walletTransactions.orderId, orders.id), eq(walletTransactions.userId, orders.userId),
    eq(walletTransactions.type, "refund"),
  ));
  // These predicates intentionally favour confirmed delivery over optimistic
  // statuses. Unknown/new services are not silently counted as delivered.
  const fulfilled = or(
    and(inArray(orders.service, ["accounts", "social", "subscriptions", "gift-cards"]), eq(orders.status, "delivered")),
    and(eq(orders.service, "numbers"), inArray(orders.status, ["active", "delivered", "expired"]), isNotNull(orders.codeReceivedAt)),
    and(eq(orders.service, "numbers"), inArray(orders.status, ["active", "expired"]), like(orders.duration, "Rent%"), sql`length(trim(${orders.providerRequestId})) > 0`, sql`length(trim(${orders.referenceCode})) > 0`),
    and(eq(orders.service, "esim"), inArray(orders.status, ["active", "delivered", "expired"]), sql`length(trim(${orders.esimIccid})) > 0`, sql`length(trim(${orders.esimActivationCode})) > 0`),
    and(eq(orders.service, "proxies"), inArray(orders.status, ["active", "expired"]), sql`length(trim(${orders.providerRequestId})) > 0`),
  );
  const [row] = await db.select({ value: count() }).from(orders).where(and(
    eq(orders.userId, userId), gte(orders.createdAt, start), lte(orders.createdAt, now), gte(orders.amount, LOYALTY_MINIMUM_ORDER_NGN),
    isNull(orders.refundedAt), exists(debit), notExists(refund), fulfilled,
  ));
  const eligibleOrders = Number(row?.value);
  const current = loyaltyLevelForOrders(eligibleOrders);
  if (!current) throw new Error("Invalid loyalty count");
  const next = LOYALTY_LEVELS.find((level) => level.level === current.level + 1) ?? null;
  return { eligibleOrders, current, next, remaining: next ? next.minimumOrders - eligibleOrders : 0 };
}
