import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { foxreloadQuotes, orders, users, type Order } from "@/db/schema";
import { debitWalletInTx, creditWalletInTx, InsufficientFundsError, makeReference } from "@/lib/payments/wallet";
import { scheduleWalletEmails } from "@/lib/email/schedule-wallet-emails";
import { afterPurchase } from "@/lib/checkout/purchase";
import { FOXRELOAD_PROVIDER } from "@/lib/services/order-providers";
import { createFoxreloadContractOrder, findFoxreloadOrderId, isFoxreloadConfigured, payFoxreloadOrder, readFoxreloadContractOrder, readFoxreloadProductContract } from "@/lib/providers/foxreload";
import { decimalUnits } from "./contract";
import { foxreloadRate } from "./exchange-rate";
import { priceStars, prepareStarsProduct, TELEGRAM_STARS_PRODUCT, telegramUsername } from "./telegram-stars";

const SERVICE = "subscriptions" as const;
const SLUG = "telegram-stars";
const QUOTE_MS = 2 * 60_000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StarsResult =
  | { kind: "quote"; id: string; amount: number; quantity: number; expiresAt: Date }
  | { kind: "order"; id: string; reference: string; status: string; replayed: boolean }
  | { kind: "error"; code: "invalid" | "unavailable" | "changed" | "insufficient" | "pending"; message: string; reference?: string };

export function starsSalesConfigured() {
  return process.env.FOXRELOAD_STARS_ENABLED === "true" && isFoxreloadConfigured() && process.env.FOXRELOAD_IS_MOCK !== "true";
}

export async function quoteTelegramStars(userId: string, quantity: number): Promise<StarsResult> {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1_000_000) return { kind: "error", code: "invalid", message: "Enter a valid number of Stars." };
  if (!starsSalesConfigured()) return { kind: "error", code: "unavailable", message: "Telegram Stars pricing is not available right now." };
  const product = await readFoxreloadProductContract(TELEGRAM_STARS_PRODUCT).catch(() => null);
  const rate = await foxreloadRate();
  const price = product && rate && priceStars(product, quantity, { FOXRELOAD_USD_NGN_RATE: rate.value });
  if (!product || !price) return { kind: "error", code: "unavailable", message: "This Stars quantity is not available right now." };
  const expiresAt = new Date(Date.now() + QUOTE_MS);
  const [quote] = await db.insert(foxreloadQuotes).values({ userId, productId: product.id, productName: product.name.slice(0, 160), quantity, wholesaleTotal: price.wholesaleTotal, currency: "usd", amount: price.amount, expiresAt }).returning({ id: foxreloadQuotes.id });
  return { kind: "quote", id: quote.id, amount: price.amount, quantity, expiresAt };
}

function intent(quoteId: string, username: string): string {
  return `stars:${createHash("sha256").update(JSON.stringify([quoteId.toLowerCase(), username.toLowerCase()])).digest("hex")}`;
}
function replay(order: Order, expected: string): StarsResult {
  if (order.service !== SERVICE || order.provider !== FOXRELOAD_PROVIDER || order.productSlug !== SLUG || order.requestIntent !== expected) {
    return { kind: "error", code: "invalid", message: "This request belongs to a different purchase. Check your orders before retrying." };
  }
  return { kind: "order", id: order.id, reference: order.reference, status: order.status, replayed: true };
}
class Replay extends Error { constructor(public order: Order) { super("replay"); } }
class Pending extends Error { constructor(public reference: string) { super("pending"); } }
class Changed extends Error {}

/** Validate supplier response before spending or treating direct delivery as complete. */
export function verifyStarsProviderOrder(raw: unknown, expected: { id?: string; total: string; quantity: number; requestId: string; quoteId: string; recipientIntent: string }, requireActive = false): { id: string; completed: boolean } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const order = raw as Record<string, unknown>;
  if (typeof order.id !== "string" || !uuid.test(order.id) || (expected.id && order.id !== expected.id) ||
      order.idempotencyKey !== expected.requestId || order.isMock !== false || order.currency !== "usd" ||
      decimalUnits(order.price) === null || decimalUnits(order.price) !== decimalUnits(expected.total) ||
      !Array.isArray(order.items) || order.items.length !== 1) return null;
  const item = order.items[0] as Record<string, unknown> | null;
  const product = item?.product as Record<string, unknown> | null;
  if (!item || !product || product.id !== TELEGRAM_STARS_PRODUCT || product.deliveryType !== "direct_topup" || item.quantity !== expected.quantity) return null;
  const note = item.note && typeof item.note === "object" && !Array.isArray(item.note) ? item.note as Record<string, unknown> : null;
  const username = note && Object.keys(note).length === 1 ? telegramUsername(note.username) : null;
  if (!username || intent(expected.quoteId, username) !== expected.recipientIntent) return null;
  if (requireActive && order.status !== "active") return null;
  return { id: order.id, completed: order.status === "completed" && item.fulfillmentStatus === "completed" };
}

export async function buyTelegramStars(input: { userId: string; quoteId: string; requestId: string; username: string }): Promise<StarsResult> {
  const username = telegramUsername(input.username);
  if (!username || !uuid.test(input.quoteId) || !uuid.test(input.requestId)) return { kind: "error", code: "invalid", message: "Enter a valid Telegram username and purchase request." };
  const requestId = input.requestId.toLowerCase(), quoteId = input.quoteId.toLowerCase();
  const requestIntent = intent(quoteId, username);
  const [existing] = await db.select().from(orders).where(and(eq(orders.userId, input.userId), eq(orders.requestId, requestId))).limit(1);
  if (existing) return replay(existing, requestIntent);
  if (!starsSalesConfigured()) return { kind: "error", code: "unavailable", message: "Telegram Stars purchases are unavailable right now." };
  const [quote] = await db.select().from(foxreloadQuotes).where(and(eq(foxreloadQuotes.id, quoteId), eq(foxreloadQuotes.userId, input.userId))).limit(1);
  if (!quote || quote.orderId || quote.expiresAt <= new Date()) return { kind: "error", code: "changed", message: "This quote has expired or was used. Get a new quote." };
  const product = await readFoxreloadProductContract(TELEGRAM_STARS_PRODUCT).catch(() => null);
  const rate = await foxreloadRate();
  const current = product && rate && priceStars(product, quote.quantity, { FOXRELOAD_USD_NGN_RATE: rate.value });
  if (!product || !current || quote.productId !== product.id || quote.currency !== "usd" || current.amount !== quote.amount || current.wholesaleTotal !== quote.wholesaleTotal) {
    return { kind: "error", code: "changed", message: "The price or availability changed. Get a new quote." };
  }
  const orderProduct = prepareStarsProduct(product);
  if (!orderProduct) return { kind: "error", code: "changed", message: "Product details changed. Get a new quote." };
  const reference = makeReference("STARS"), orderId = randomUUID();
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.userId}))`);
      const [raced] = await tx.select().from(orders).where(and(eq(orders.userId, input.userId), eq(orders.requestId, requestId))).limit(1);
      if (raced) throw new Replay(raced);
      const [unresolved] = await tx.select({ reference: orders.reference }).from(orders).where(and(eq(orders.userId, input.userId), eq(orders.service, SERVICE), eq(orders.provider, FOXRELOAD_PROVIDER), eq(orders.productSlug, SLUG), inArray(orders.status, ["review", "processing"]), isNull(orders.refundedAt))).limit(1);
      if (unresolved) throw new Pending(unresolved.reference);
      await tx.insert(orders).values({ id: orderId, reference, userId: input.userId, requestId, requestIntent, service: SERVICE, productSlug: SLUG, productName: "Telegram Stars", planLabel: `${quote.quantity} Stars for @${username}`, quantity: quote.quantity, region: "Telegram", duration: "Digital delivery", amount: quote.amount, status: "review", provider: FOXRELOAD_PROVIDER, reconciliationNote: "Stars claimed; supplier order not yet started." });
      const [consumed] = await tx.update(foxreloadQuotes).set({ orderId }).where(and(eq(foxreloadQuotes.id, quote.id), eq(foxreloadQuotes.userId, input.userId), isNull(foxreloadQuotes.orderId), gt(foxreloadQuotes.expiresAt, new Date()))).returning({ id: foxreloadQuotes.id });
      if (!consumed) throw new Changed();
      await debitWalletInTx(tx, { userId: input.userId, amount: quote.amount, type: "debit", description: `Telegram Stars · ${quote.quantity}`, orderId, reference });
    });
  } catch (error) {
    if (error instanceof Replay) return replay(error.order, requestIntent);
    if (error instanceof Pending) return { kind: "error", code: "pending", message: "An earlier Stars purchase needs review before you can order again.", reference: error.reference };
    if (error instanceof Changed) return { kind: "error", code: "changed", message: "This quote has expired or was used. Get a new quote." };
    if (error instanceof InsufficientFundsError) return { kind: "error", code: "insufficient", message: "Insufficient wallet balance." };
    const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") {
      const [winner] = await db.select().from(orders).where(and(eq(orders.userId, input.userId), eq(orders.requestId, requestId))).limit(1);
      if (winner) return replay(winner, requestIntent);
    }
    throw error;
  }
  scheduleWalletEmails();
  let providerId: string | null = null;
  try {
    const canStart = await db.transaction(async (tx) => {
      const [account] = await tx.select({ suspendedAt: users.suspendedAt, deletedAt: users.deletedAt }).from(users).where(eq(users.id, input.userId)).for("update").limit(1);
      if (!account || account.suspendedAt || account.deletedAt) {
        const [claimed] = await tx.update(orders).set({ status: "refunded", refundedAt: new Date(), reconciliationNote: "Account became unavailable before supplier order; debit returned." }).where(and(eq(orders.id, orderId), eq(orders.status, "review"), isNull(orders.refundedAt))).returning({ id: orders.id });
        if (!claimed) return false;
        await creditWalletInTx(tx, { userId: input.userId, amount: quote.amount, type: "refund", description: "Telegram Stars · purchase not started", orderId, reference: makeReference("RFB") });
        return false;
      }
      const [claim] = await tx.update(orders).set({ status: "processing", reconciliationNote: "Stars supplier order creation started; verify outcome before any refund or retry." }).where(and(eq(orders.id, orderId), eq(orders.status, "review"), isNull(orders.refundedAt))).returning({ id: orders.id });
      return Boolean(claim);
    });
    if (!canStart) {
      scheduleWalletEmails();
      const [current] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, input.userId))).limit(1);
      return { kind: "order", id: orderId, reference, status: current?.status ?? "review", replayed: false };
    }
    const created = await createFoxreloadContractOrder({ product: orderProduct, quantity: quote.quantity, note: { username }, idempotencyKey: orderId, mock: false });
    // Persist any valid identifier even if the rest of the response is malformed.
    if (created && typeof created === "object" && "id" in created && typeof created.id === "string" && uuid.test(created.id)) {
      providerId = created.id;
      const [saved] = await db.update(orders).set({ providerRequestId: providerId, reconciliationNote: "Stars supplier order created; payment not yet confirmed." }).where(and(eq(orders.id, orderId), eq(orders.status, "processing"), isNull(orders.refundedAt))).returning({ id: orders.id });
      if (!saved) throw new Error("Order claim lost");
    }
    const verified = verifyStarsProviderOrder(created, { total: quote.wholesaleTotal, quantity: quote.quantity, requestId: orderId, quoteId, recipientIntent: requestIntent }, true);
    if (!verified) throw new Error("Supplier order terms could not be verified");
    // Only this request can cross the payment boundary, and processing prevents
    // the admin refund path from racing the in-flight payment.
    await payFoxreloadOrder(verified.id);
    await db.update(orders).set({ status: "review", reconciliationNote: "Stars payment submitted; awaiting confirmed delivery." }).where(and(eq(orders.id, orderId), eq(orders.status, "processing"), isNull(orders.refundedAt)));
    await syncTelegramStars(orderId, input.userId);
  } catch {
    // Never retry create/pay or auto-refund after a supplier call can start.
    await db.update(orders).set({ status: "review", ...(providerId ? { providerRequestId: providerId } : {}), reconciliationNote: "Stars supplier outcome uncertain; reconcile before refund or retry." }).where(and(eq(orders.id, orderId), eq(orders.status, "processing"), isNull(orders.refundedAt))).catch(() => {});
  }
  const [saved] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, input.userId))).limit(1);
  return { kind: "order", id: orderId, reference, status: saved?.status ?? "review", replayed: false };
}

/** Read-only provider sync. Unknown, failed and refunded supplier states need review. */
export async function syncTelegramStars(orderId: string, userId: string): Promise<void> {
  const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, userId), eq(orders.service, SERVICE), eq(orders.productSlug, SLUG), eq(orders.provider, FOXRELOAD_PROVIDER), inArray(orders.status, ["review", "processing"]), isNull(orders.refundedAt))).limit(1);
  if (!order?.requestId || !order.requestIntent) return;
  const [quote] = await db.select().from(foxreloadQuotes).where(and(eq(foxreloadQuotes.orderId, order.id), eq(foxreloadQuotes.userId, userId))).limit(1);
  if (!quote) return;
  // Shared cooldown and fair sweep ordering; claim the check before network I/O.
  const [claim] = await db.update(foxreloadQuotes).set({ lastCheckedAt: new Date() }).where(and(eq(foxreloadQuotes.id, quote.id), or(isNull(foxreloadQuotes.lastCheckedAt), lte(foxreloadQuotes.lastCheckedAt, new Date(Date.now() - 20_000))))).returning({ id: foxreloadQuotes.id });
  if (!claim) return;
  const providerId = order.providerRequestId ?? await findFoxreloadOrderId(order.id).catch(() => null);
  if (!providerId) return;
  const raw = await readFoxreloadContractOrder(providerId).catch(() => null);
  const verified = verifyStarsProviderOrder(raw, { id: providerId, total: quote.wholesaleTotal, quantity: quote.quantity, requestId: order.id, quoteId: quote.id, recipientIntent: order.requestIntent });
  if (!verified) return;
  if (!order.providerRequestId) {
    const [linked] = await db.update(orders).set({ providerRequestId: verified.id, reconciliationNote: "Stars supplier order found; payment and delivery require verification." })
      .where(and(eq(orders.id, order.id), eq(orders.userId, userId), inArray(orders.status, ["review", "processing"]), isNull(orders.providerRequestId), isNull(orders.refundedAt))).returning({ id: orders.id });
    if (!linked) return;
  }
  if (!verified.completed) return;
  const [saved] = await db.update(orders).set({ status: "delivered", reconciliationNote: null }).where(and(eq(orders.id, order.id), inArray(orders.status, ["review", "processing"]), eq(orders.providerRequestId, providerId), isNull(orders.refundedAt))).returning({ id: orders.id });
  if (saved) void afterPurchase(userId);
}

/** Bounded fair status sweep; it never creates, pays, refunds or retries orders. */
export async function sweepTelegramStars(): Promise<number> {
  if (!isFoxreloadConfigured()) return 0;
  const candidates = await db.select({ id: orders.id, userId: orders.userId }).from(foxreloadQuotes)
    .innerJoin(orders, eq(orders.id, foxreloadQuotes.orderId))
    .where(and(eq(orders.provider, FOXRELOAD_PROVIDER), eq(orders.service, SERVICE), eq(orders.productSlug, SLUG),
      inArray(orders.status, ["review", "processing"]), isNull(orders.refundedAt),
      or(isNull(foxreloadQuotes.lastCheckedAt), lte(foxreloadQuotes.lastCheckedAt, new Date(Date.now() - 20_000)))))
    .orderBy(sql`${foxreloadQuotes.lastCheckedAt} ASC NULLS FIRST`, orders.createdAt, orders.id).limit(8);
  await Promise.allSettled(candidates.map((row) => syncTelegramStars(row.id, row.userId)));
  return candidates.length;
}

/** Keep consumed quotes as order evidence; prune only old unconsumed quotes. */
export async function pruneTelegramQuotes(): Promise<number> {
  const cutoff = new Date(Date.now() - 86_400_000);
  const eligible = and(isNull(foxreloadQuotes.orderId), lte(foxreloadQuotes.expiresAt, cutoff));
  const ids = await db.select({ id: foxreloadQuotes.id }).from(foxreloadQuotes).where(eligible).orderBy(foxreloadQuotes.expiresAt).limit(500);
  if (!ids.length) return 0;
  const deleted = await db.delete(foxreloadQuotes).where(and(inArray(foxreloadQuotes.id, ids.map((item) => item.id)), eligible)).returning({ id: foxreloadQuotes.id });
  return deleted.length;
}
