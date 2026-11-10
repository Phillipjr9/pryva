import "server-only";
import { randomUUID } from "node:crypto";
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
import { approvedTopupOffers, normalizeTopupNote, prepareTopup, publicTopupId, topupFingerprint, topupIntent, topupPrice, type TopupField } from "./topup-offers";
const SERVICE = "subscriptions" as const, DIRECT_SLUG = "direct-topup", LOGIN_SLUG = "login-topup";
const slug = (deliveryType: "direct_topup" | "login_topup") => deliveryType === "login_topup" ? LOGIN_SLUG : DIRECT_SLUG;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Result = { kind: "quote"; id: string; amount: number; name: string; region: string; terms: string; quantity: number; fields: TopupField[]; deliveryType: "direct_topup" | "login_topup"; expiresAt: Date }
  | { kind: "order"; id: string; reference: string; status: string; replayed: boolean }
  | { kind: "error"; code: "invalid" | "unavailable" | "changed" | "insufficient" | "pending"; message: string; reference?: string };
function hasSecret() { const secret = process.env.FOXRELOAD_INTENT_SECRET; return !!secret && secret.length >= 32 && secret.length <= 1024; }
function baseConfigured() { return isFoxreloadConfigured() && process.env.FOXRELOAD_IS_MOCK !== "true" && hasSecret(); }
function enabledFor(type: "direct_topup" | "login_topup") { return baseConfigured() && (type === "login_topup" ? process.env.FOXRELOAD_LOGIN_TOPUPS_ENABLED === "true" && process.env.FOXRELOAD_CLIENT_CODES_ENABLED === "true" : process.env.FOXRELOAD_TOPUPS_ENABLED === "true"); }
function anyConfigured() { return enabledFor("direct_topup") || enabledFor("login_topup"); }
export function listedTopupOffers() {
  return approvedTopupOffers().filter((offer) => enabledFor(offer.deliveryType ?? "direct_topup")).map(({ id, name, region, min, max }) => ({ id: publicTopupId(id), name, region, min, max }));
}
export async function quoteTopup(userId: string, publicId: string, quantity: number): Promise<Result> {
  if (!/^digital-[a-f0-9]{24}$/.test(publicId) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1_000_000) return { kind: "error", code: "invalid", message: "Invalid product or quantity." };
  if (!anyConfigured()) return { kind: "error", code: "unavailable", message: "Top-ups are unavailable right now." };
  const offer = approvedTopupOffers().find((entry) => publicTopupId(entry.id) === publicId);
  if (!offer || !enabledFor(offer.deliveryType ?? "direct_topup")) return { kind: "error", code: "unavailable", message: "This product is unavailable." };
  const product = await readFoxreloadProductContract(offer.id).catch(() => null);
  const rate = await foxreloadRate();
  const price = product && rate && topupPrice(product, offer, quantity, { FOXRELOAD_USD_NGN_RATE: rate.value });
  if (!price) return { kind: "error", code: "unavailable", message: "A current price is unavailable for this product or quantity." };
  const expiresAt = new Date(Date.now() + 120_000);
  const [quote] = await db.insert(foxreloadQuotes).values({ userId, productId: offer.id, productName: topupFingerprint(offer), customerTerms: offer.terms, quantity, wholesaleTotal: price.wholesaleTotal, currency: "usd", amount: price.amount, expiresAt }).returning({ id: foxreloadQuotes.id });
  return { kind: "quote", id: quote.id, amount: price.amount, name: offer.name, region: offer.region, terms: offer.terms, quantity, fields: offer.fields, deliveryType: offer.deliveryType ?? "direct_topup", expiresAt };
}
function replay(order: Order, expected: string): Result {
  if (order.service !== SERVICE || order.provider !== FOXRELOAD_PROVIDER || ![DIRECT_SLUG, LOGIN_SLUG].includes(order.productSlug) || order.requestIntent !== expected) return { kind: "error", code: "invalid", message: "This request belongs to another purchase or recipient. Check your orders." };
  return { kind: "order", id: order.id, reference: order.reference, status: order.status, replayed: true };
}
class Replay extends Error { constructor(public order: Order) { super("replay"); } }
class Pending extends Error { constructor(public reference: string) { super("pending"); } }
class Changed extends Error {}
export function verifyTopupProviderOrder(raw: unknown, expected: { id?: string; productId: string; total: string; requestId: string; quantity: number; userId: string; quoteId: string; intent: string; deliveryType?: "direct_topup" | "login_topup" }, active = false): { id: string; completed: boolean } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const order = raw as Record<string, unknown>;
  if (typeof order.id !== "string" || !uuid.test(order.id) || (expected.id && order.id !== expected.id) || order.idempotencyKey !== expected.requestId || order.isMock !== false || order.currency !== "usd" ||
    decimalUnits(order.price) === null || decimalUnits(order.price) !== decimalUnits(expected.total) || !Array.isArray(order.items) || order.items.length !== 1) return null;
  const item = order.items[0] as Record<string, unknown> | null, product = item?.product as Record<string, unknown> | null;
  const note = normalizeTopupNote(item?.note);
  if (!item || !product || product.id !== expected.productId || product.deliveryType !== (expected.deliveryType ?? "direct_topup") || item.quantity !== expected.quantity ||
      !note || topupIntent(expected.userId, expected.quoteId, note) !== expected.intent || (active && order.status !== "active")) return null;
  return { id: order.id, completed: order.status === "completed" && item.fulfillmentStatus === "completed" };
}
export async function buyTopup(input: { userId: string; quoteId: string; requestId: string; note: unknown }): Promise<Result> {
  if (!uuid.test(input.quoteId) || !uuid.test(input.requestId)) return { kind: "error", code: "invalid", message: "Invalid purchase request." };
  const quoteId = input.quoteId.toLowerCase(), requestId = input.requestId.toLowerCase(), note = normalizeTopupNote(input.note);
  if (!note) return { kind: "error", code: "invalid", message: "Enter the recipient details exactly as requested." };
  const requestIntent = topupIntent(input.userId, quoteId, note);
  if (!requestIntent) return { kind: "error", code: "unavailable", message: "Top-up recovery is unavailable right now." };
  const [existing] = await db.select().from(orders).where(and(eq(orders.userId, input.userId), eq(orders.requestId, requestId))).limit(1);
  if (existing) return replay(existing, requestIntent);
  if (!anyConfigured()) return { kind: "error", code: "unavailable", message: "Top-ups are unavailable right now." };
  const [quote] = await db.select().from(foxreloadQuotes).where(and(eq(foxreloadQuotes.id, quoteId), eq(foxreloadQuotes.userId, input.userId))).limit(1);
  if (!quote || quote.orderId || quote.expiresAt <= new Date() || quote.currency !== "usd") return { kind: "error", code: "changed", message: "Quote expired or already used. Get a new quote." };
  const offer = approvedTopupOffers().find((entry) => entry.id === quote.productId && topupFingerprint(entry) === quote.productName);
  if (!offer || quote.customerTerms !== offer.terms) return { kind: "error", code: "changed", message: "Product terms changed. Get a new quote." };
  const deliveryType = offer.deliveryType ?? "direct_topup", productSlug = slug(deliveryType);
  if (!enabledFor(deliveryType)) return { kind: "error", code: "unavailable", message: "This product is unavailable." };
  if (!normalizeTopupNote(note, offer.fields)) return { kind: "error", code: "invalid", message: "Enter the requested recipient details." };
  const product = await readFoxreloadProductContract(offer.id).catch(() => null);
  const rate = await foxreloadRate();
  const current = product && rate && topupPrice(product, offer, quote.quantity, { FOXRELOAD_USD_NGN_RATE: rate.value }), prepared = product && prepareTopup(product, offer);
  if (!prepared || !current || current.amount !== quote.amount || current.wholesaleTotal !== quote.wholesaleTotal) return { kind: "error", code: "changed", message: "Price or availability changed. Get a new quote." };
  const orderId = randomUUID(), reference = makeReference("TOPUP");
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.userId}))`);
      const [raced] = await tx.select().from(orders).where(and(eq(orders.userId, input.userId), eq(orders.requestId, requestId))).limit(1);
      if (raced) throw new Replay(raced);
      const [pending] = await tx.select({ reference: orders.reference }).from(orders).where(and(eq(orders.userId, input.userId), eq(orders.service, SERVICE), eq(orders.provider, FOXRELOAD_PROVIDER), eq(orders.productSlug, productSlug), inArray(orders.status, ["review", "processing"]), isNull(orders.refundedAt))).limit(1);
      if (pending) throw new Pending(pending.reference);
      await tx.insert(orders).values({ id: orderId, reference, userId: input.userId, requestId, requestIntent, service: SERVICE, productSlug, productName: offer.name, planLabel: `${quote.quantity} unit(s)`, quantity: quote.quantity, region: offer.region, duration: "Digital delivery", amount: quote.amount, status: "review", provider: FOXRELOAD_PROVIDER, reconciliationNote: "Top-up claimed; supplier order not yet started." });
      const [consumed] = await tx.update(foxreloadQuotes).set({ orderId }).where(and(eq(foxreloadQuotes.id, quote.id), eq(foxreloadQuotes.userId, input.userId), isNull(foxreloadQuotes.orderId), gt(foxreloadQuotes.expiresAt, new Date()))).returning({ id: foxreloadQuotes.id });
      if (!consumed) throw new Changed();
      await debitWalletInTx(tx, { userId: input.userId, amount: quote.amount, type: "debit", description: `Direct top-up · ${offer.name}`, orderId, reference });
    });
  } catch (error) {
    if (error instanceof Replay) return replay(error.order, requestIntent);
    if (error instanceof Pending) return { kind: "error", code: "pending", message: "An earlier top-up needs review before another purchase.", reference: error.reference };
    if (error instanceof Changed) return { kind: "error", code: "changed", message: "Quote expired or already used." };
    if (error instanceof InsufficientFundsError) return { kind: "error", code: "insufficient", message: "Insufficient wallet balance." };
    const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") { const [winner] = await db.select().from(orders).where(and(eq(orders.userId, input.userId), eq(orders.requestId, requestId))).limit(1); if (winner) return replay(winner, requestIntent); }
    throw error;
  }
  scheduleWalletEmails();
  let providerId: string | null = null;
  try {
    const started = await db.transaction(async (tx) => {
      const [account] = await tx.select({ suspendedAt: users.suspendedAt, deletedAt: users.deletedAt }).from(users).where(eq(users.id, input.userId)).for("update").limit(1);
      if (!account || account.suspendedAt || account.deletedAt) {
        const [claimed] = await tx.update(orders).set({ status: "refunded", refundedAt: new Date(), reconciliationNote: "Account unavailable before supplier order; debit returned." }).where(and(eq(orders.id, orderId), eq(orders.status, "review"), isNull(orders.refundedAt))).returning({ id: orders.id });
        if (claimed) await creditWalletInTx(tx, { userId: input.userId, amount: quote.amount, type: "refund", description: "Direct top-up · purchase not started", orderId, reference: makeReference("RFB") });
        return false;
      }
      const [claim] = await tx.update(orders).set({ status: "processing", reconciliationNote: "Supplier order creation started; verify outcome before refund or retry." }).where(and(eq(orders.id, orderId), eq(orders.status, "review"), isNull(orders.refundedAt))).returning({ id: orders.id });
      return Boolean(claim);
    });
    if (started) {
      const created = await createFoxreloadContractOrder({ product: prepared, quantity: quote.quantity, note, idempotencyKey: orderId, mock: false });
      if (created && typeof created === "object" && "id" in created && typeof created.id === "string" && uuid.test(created.id)) {
        providerId = created.id;
        const [saved] = await db.update(orders).set({ providerRequestId: providerId, reconciliationNote: "Supplier order created; payment not yet confirmed." }).where(and(eq(orders.id, orderId), eq(orders.status, "processing"), isNull(orders.refundedAt))).returning({ id: orders.id });
        if (!saved) throw new Error("Order claim lost");
      }
      const verified = verifyTopupProviderOrder(created, { productId: offer.id, total: quote.wholesaleTotal, requestId: orderId, quantity: quote.quantity, userId: input.userId, quoteId, intent: requestIntent, deliveryType }, true);
      if (!verified) throw new Error("Supplier order terms could not be verified");
      await payFoxreloadOrder(verified.id);
      await db.update(orders).set({ status: "review", reconciliationNote: "Payment submitted; awaiting confirmed delivery." }).where(and(eq(orders.id, orderId), eq(orders.status, "processing"), isNull(orders.refundedAt)));
      await syncTopupOrder(orderId, input.userId);
    } else scheduleWalletEmails();
  } catch {
    await db.update(orders).set({ status: "review", ...(providerId ? { providerRequestId: providerId } : {}), reconciliationNote: "Supplier outcome uncertain; reconcile before refund or retry." }).where(and(eq(orders.id, orderId), eq(orders.status, "processing"), isNull(orders.refundedAt))).catch(() => {});
  }
  const [saved] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, input.userId))).limit(1);
  return { kind: "order", id: orderId, reference, status: saved?.status ?? "review", replayed: false };
}
export async function syncTopupOrder(orderId: string, userId: string): Promise<void> {
  if (!hasSecret()) return;
  const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, userId), eq(orders.service, SERVICE), inArray(orders.productSlug, [DIRECT_SLUG, LOGIN_SLUG]), eq(orders.provider, FOXRELOAD_PROVIDER), inArray(orders.status, ["review", "processing"]), isNull(orders.refundedAt))).limit(1);
  if (!order?.requestId || !order.requestIntent) return;
  const [quote] = await db.select().from(foxreloadQuotes).where(and(eq(foxreloadQuotes.orderId, order.id), eq(foxreloadQuotes.userId, userId))).limit(1);
  if (!quote) return;
  const [claim] = await db.update(foxreloadQuotes).set({ lastCheckedAt: new Date() }).where(and(eq(foxreloadQuotes.id, quote.id), or(isNull(foxreloadQuotes.lastCheckedAt), lte(foxreloadQuotes.lastCheckedAt, new Date(Date.now() - 20_000))))).returning({ id: foxreloadQuotes.id });
  if (!claim) return;
  // If create timed out before its ID was saved, look up our unique key. This
  // is read-only: never re-create, re-pay, or infer a refund from no result.
  const providerId = order.providerRequestId ?? await findFoxreloadOrderId(order.id).catch(() => null);
  if (!providerId) return;
  const raw = await readFoxreloadContractOrder(providerId).catch(() => null);
  const verified = verifyTopupProviderOrder(raw, { id: providerId, productId: quote.productId, total: quote.wholesaleTotal, requestId: order.id, quantity: quote.quantity, userId, quoteId: quote.id, intent: order.requestIntent, deliveryType: order.productSlug === LOGIN_SLUG ? "login_topup" : "direct_topup" });
  if (!verified) return;
  if (!order.providerRequestId) {
    const [linked] = await db.update(orders).set({ providerRequestId: verified.id, reconciliationNote: "Supplier order found; payment and delivery require verification." })
      .where(and(eq(orders.id, order.id), eq(orders.userId, userId), inArray(orders.status, ["review", "processing"]), isNull(orders.providerRequestId), isNull(orders.refundedAt))).returning({ id: orders.id });
    if (!linked) return;
  }
  if (!verified.completed) return;
  const [saved] = await db.update(orders).set({ status: "delivered", reconciliationNote: null }).where(and(eq(orders.id, order.id), inArray(orders.status, ["review", "processing"]), eq(orders.providerRequestId, providerId), isNull(orders.refundedAt))).returning({ id: orders.id });
  if (saved) { scheduleWalletEmails(); void afterPurchase(userId); }
}
export async function sweepTopupOrders(): Promise<number> {
  if (!isFoxreloadConfigured() || !hasSecret()) return 0;
  const candidates = await db.select({ id: orders.id, userId: orders.userId }).from(foxreloadQuotes).innerJoin(orders, eq(orders.id, foxreloadQuotes.orderId))
    .where(and(eq(orders.provider, FOXRELOAD_PROVIDER), eq(orders.service, SERVICE), inArray(orders.productSlug, [DIRECT_SLUG, LOGIN_SLUG]), inArray(orders.status, ["review", "processing"]), isNull(orders.refundedAt), or(isNull(foxreloadQuotes.lastCheckedAt), lte(foxreloadQuotes.lastCheckedAt, new Date(Date.now() - 20_000)))))
    .orderBy(sql`${foxreloadQuotes.lastCheckedAt} ASC NULLS FIRST`, orders.createdAt, orders.id).limit(8);
  await Promise.allSettled(candidates.map((row) => syncTopupOrder(row.id, row.userId)));
  return candidates.length;
}
