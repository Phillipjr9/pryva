import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, isNotNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { foxreloadQuotes, orders, users, type Order } from "@/db/schema";
import { debitWalletInTx, creditWalletInTx, InsufficientFundsError, makeReference } from "@/lib/payments/wallet";
import { scheduleWalletEmails } from "@/lib/email/schedule-wallet-emails";
import { afterPurchase } from "@/lib/checkout/purchase";
import { FOXRELOAD_PROVIDER } from "@/lib/services/order-providers";
import { createFoxreloadContractOrder, isFoxreloadConfigured, payFoxreloadOrder, readFoxreloadContractOrder, readFoxreloadProductContract } from "@/lib/providers/foxreload";
import { decimalUnits } from "./contract";
import { approvedCodeOffers, offerFingerprint, priceCode, publicCodeId } from "./code-offers";

const SERVICE = "gift-cards" as const, SLUG = "digital-code";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Result = { kind: "quote"; id: string; amount: number; name: string; region: string; expiresAt: Date }
  | { kind: "order"; id: string; reference: string; status: string; replayed: boolean }
  | { kind: "error"; code: "invalid" | "unavailable" | "changed" | "insufficient" | "pending"; message: string; reference?: string };
function configured() { return process.env.FOXRELOAD_CODES_ENABLED === "true" && isFoxreloadConfigured() && process.env.FOXRELOAD_IS_MOCK !== "true" && Boolean(process.env.FOXRELOAD_USD_NGN_RATE?.trim()); }
export function listedCodeOffers() {
  return configured() ? approvedCodeOffers().map(({ id, name, region }) => ({ id: publicCodeId(id), name, region })) : [];
}
export async function quoteCode(userId: string, publicId: string): Promise<Result> {
  if (!/^digital-[a-f0-9]{24}$/.test(publicId)) return { kind: "error", code: "invalid", message: "Invalid product." };
  if (!configured()) return { kind: "error", code: "unavailable", message: "Code purchases are unavailable right now." };
  const offer = approvedCodeOffers().find((entry) => publicCodeId(entry.id) === publicId);
  if (!offer) return { kind: "error", code: "unavailable", message: "This product is unavailable." };
  const product = await readFoxreloadProductContract(offer.id).catch(() => null);
  const price = product && priceCode(product, offer);
  if (!price) return { kind: "error", code: "unavailable", message: "A current price is unavailable for this product." };
  const expiresAt = new Date(Date.now() + 120_000);
  const [quote] = await db.insert(foxreloadQuotes).values({ userId, productId: offer.id, productName: offerFingerprint(offer), quantity: 1, wholesaleTotal: price.wholesaleTotal, currency: "usd", amount: price.amount, expiresAt }).returning({ id: foxreloadQuotes.id });
  return { kind: "quote", id: quote.id, amount: price.amount, name: offer.name, region: offer.region, expiresAt };
}
function intent(id: string) { return `code:${createHash("sha256").update(id.toLowerCase()).digest("hex")}`; }
function replay(order: Order, expected: string): Result {
  if (order.service !== SERVICE || order.provider !== FOXRELOAD_PROVIDER || order.productSlug !== SLUG || order.requestIntent !== expected) return { kind: "error", code: "invalid", message: "This request belongs to another purchase. Check your orders." };
  return { kind: "order", id: order.id, reference: order.reference, status: order.status, replayed: true };
}
class Replay extends Error { constructor(public order: Order) { super("replay"); } }
class Pending extends Error { constructor(public reference: string) { super("pending"); } }
class Changed extends Error {}
function verify(raw: unknown, expected: { id?: string; productId: string; total: string; requestId: string }, active = false): { id: string; code: string | null } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const order = raw as Record<string, unknown>;
  if (typeof order.id !== "string" || !uuid.test(order.id) || (expected.id && order.id !== expected.id) || order.idempotencyKey !== expected.requestId || order.isMock !== false || order.currency !== "usd" ||
    decimalUnits(order.price) === null || decimalUnits(order.price) !== decimalUnits(expected.total) || !Array.isArray(order.items) || order.items.length !== 1) return null;
  const item = order.items[0] as Record<string, unknown> | null;
  const product = item?.product as Record<string, unknown> | null;
  if (!item || !product || product.id !== expected.productId || product.deliveryType !== "code" || item.quantity !== 1 || (active && order.status !== "active")) return null;
  let code: string | null = null;
  // Restrict this first slice to one opaque bearer code. Multi-part deliveries
  // need their own presentation/validation and stay in review instead.
  if (order.status === "completed" && item.fulfillmentStatus === "completed" && Array.isArray(item.externalData) && item.externalData.length === 1 &&
      typeof item.externalData[0] === "string" && item.externalData[0].trim() && item.externalData[0].length <= 4096 && !/[\u0000-\u001f\u007f]/.test(item.externalData[0])) code = item.externalData[0];
  return { id: order.id, code };
}
export async function buyCode(input: { userId: string; quoteId: string; requestId: string }): Promise<Result> {
  if (!uuid.test(input.quoteId) || !uuid.test(input.requestId)) return { kind: "error", code: "invalid", message: "Invalid purchase request." };
  const quoteId = input.quoteId.toLowerCase(), requestId = input.requestId.toLowerCase(), requestIntent = intent(quoteId);
  const [existing] = await db.select().from(orders).where(and(eq(orders.userId, input.userId), eq(orders.requestId, requestId))).limit(1);
  if (existing) return replay(existing, requestIntent);
  if (!configured()) return { kind: "error", code: "unavailable", message: "Code purchases are unavailable right now." };
  const [quote] = await db.select().from(foxreloadQuotes).where(and(eq(foxreloadQuotes.id, quoteId), eq(foxreloadQuotes.userId, input.userId))).limit(1);
  if (!quote || quote.orderId || quote.expiresAt <= new Date() || quote.quantity !== 1 || quote.currency !== "usd") return { kind: "error", code: "changed", message: "Quote expired or already used. Get a new quote." };
  const offer = approvedCodeOffers().find((entry) => entry.id === quote.productId && offerFingerprint(entry) === quote.productName);
  if (!offer) return { kind: "error", code: "changed", message: "Product terms changed. Get a new quote." };
  const product = await readFoxreloadProductContract(offer.id).catch(() => null);
  const current = product && priceCode(product, offer);
  if (!product || !current || current.amount !== quote.amount || current.wholesaleTotal !== quote.wholesaleTotal) return { kind: "error", code: "changed", message: "Price or availability changed. Get a new quote." };
  const orderId = randomUUID(), reference = makeReference("CODE");
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.userId}))`);
      const [raced] = await tx.select().from(orders).where(and(eq(orders.userId, input.userId), eq(orders.requestId, requestId))).limit(1);
      if (raced) throw new Replay(raced);
      const [pending] = await tx.select({ reference: orders.reference }).from(orders).where(and(eq(orders.userId, input.userId), eq(orders.service, SERVICE), eq(orders.provider, FOXRELOAD_PROVIDER), eq(orders.productSlug, SLUG), inArray(orders.status, ["review", "processing"]), isNull(orders.refundedAt))).limit(1);
      if (pending) throw new Pending(pending.reference);
      await tx.insert(orders).values({ id: orderId, reference, userId: input.userId, requestId, requestIntent, service: SERVICE, productSlug: SLUG, productName: offer.name, planLabel: "Digital code", quantity: 1, region: offer.region, duration: "Digital delivery", amount: quote.amount, status: "review", provider: FOXRELOAD_PROVIDER, reconciliationNote: "Code claimed; supplier order not yet started." });
      const [consumed] = await tx.update(foxreloadQuotes).set({ orderId }).where(and(eq(foxreloadQuotes.id, quote.id), eq(foxreloadQuotes.userId, input.userId), isNull(foxreloadQuotes.orderId), gt(foxreloadQuotes.expiresAt, new Date()))).returning({ id: foxreloadQuotes.id });
      if (!consumed) throw new Changed();
      await debitWalletInTx(tx, { userId: input.userId, amount: quote.amount, type: "debit", description: `Digital code · ${offer.name}`, orderId, reference });
    });
  } catch (error) {
    if (error instanceof Replay) return replay(error.order, requestIntent);
    if (error instanceof Pending) return { kind: "error", code: "pending", message: "An earlier code order needs review before another purchase.", reference: error.reference };
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
        if (claimed) await creditWalletInTx(tx, { userId: input.userId, amount: quote.amount, type: "refund", description: "Digital code · purchase not started", orderId, reference: makeReference("RFB") });
        return false;
      }
      const [claim] = await tx.update(orders).set({ status: "processing", reconciliationNote: "Supplier order creation started; verify outcome before refund or retry." }).where(and(eq(orders.id, orderId), eq(orders.status, "review"), isNull(orders.refundedAt))).returning({ id: orders.id });
      return Boolean(claim);
    });
    if (started) {
      const created = await createFoxreloadContractOrder({ product, quantity: 1, note: {}, idempotencyKey: orderId, mock: false });
      if (created && typeof created === "object" && "id" in created && typeof created.id === "string" && uuid.test(created.id)) {
        providerId = created.id;
        const [saved] = await db.update(orders).set({ providerRequestId: providerId, reconciliationNote: "Supplier order created; payment not yet confirmed." }).where(and(eq(orders.id, orderId), eq(orders.status, "processing"), isNull(orders.refundedAt))).returning({ id: orders.id });
        if (!saved) throw new Error("Order claim lost");
      }
      const verified = verify(created, { productId: offer.id, total: quote.wholesaleTotal, requestId: orderId }, true);
      if (!verified) throw new Error("Supplier order terms could not be verified");
      await payFoxreloadOrder(verified.id);
      await db.update(orders).set({ status: "review", reconciliationNote: "Payment submitted; awaiting confirmed code." }).where(and(eq(orders.id, orderId), eq(orders.status, "processing"), isNull(orders.refundedAt)));
      await syncCodeOrder(orderId, input.userId);
    } else scheduleWalletEmails();
  } catch {
    await db.update(orders).set({ status: "review", ...(providerId ? { providerRequestId: providerId } : {}), reconciliationNote: "Supplier outcome uncertain; reconcile before refund or retry." }).where(and(eq(orders.id, orderId), eq(orders.status, "processing"), isNull(orders.refundedAt))).catch(() => {});
  }
  const [saved] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, input.userId))).limit(1);
  return { kind: "order", id: orderId, reference, status: saved?.status ?? "review", replayed: false };
}
export async function syncCodeOrder(orderId: string, userId: string): Promise<void> {
  const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.userId, userId), eq(orders.service, SERVICE), eq(orders.productSlug, SLUG), eq(orders.provider, FOXRELOAD_PROVIDER), inArray(orders.status, ["review", "processing"]), isNull(orders.refundedAt))).limit(1);
  if (!order?.providerRequestId || !order.requestId) return;
  const [quote] = await db.select().from(foxreloadQuotes).where(and(eq(foxreloadQuotes.orderId, order.id), eq(foxreloadQuotes.userId, userId))).limit(1);
  if (!quote) return;
  const [claim] = await db.update(foxreloadQuotes).set({ lastCheckedAt: new Date() }).where(and(eq(foxreloadQuotes.id, quote.id), or(isNull(foxreloadQuotes.lastCheckedAt), lte(foxreloadQuotes.lastCheckedAt, new Date(Date.now() - 20_000))))).returning({ id: foxreloadQuotes.id });
  if (!claim) return;
  const raw = await readFoxreloadContractOrder(order.providerRequestId).catch(() => null);
  const verified = verify(raw, { id: order.providerRequestId, productId: quote.productId, total: quote.wholesaleTotal, requestId: order.id });
  if (!verified?.code) return;
  const [saved] = await db.update(orders).set({ status: "delivered", referenceCode: verified.code, reconciliationNote: null }).where(and(eq(orders.id, order.id), inArray(orders.status, ["review", "processing"]), eq(orders.providerRequestId, order.providerRequestId), isNull(orders.refundedAt))).returning({ id: orders.id });
  if (saved) { scheduleWalletEmails(); void afterPurchase(userId); }
}
export async function sweepCodeOrders(): Promise<number> {
  if (!isFoxreloadConfigured()) return 0;
  const candidates = await db.select({ id: orders.id, userId: orders.userId }).from(foxreloadQuotes).innerJoin(orders, eq(orders.id, foxreloadQuotes.orderId))
    .where(and(eq(orders.provider, FOXRELOAD_PROVIDER), eq(orders.service, SERVICE), eq(orders.productSlug, SLUG), inArray(orders.status, ["review", "processing"]), isNull(orders.refundedAt), isNotNull(orders.providerRequestId), or(isNull(foxreloadQuotes.lastCheckedAt), lte(foxreloadQuotes.lastCheckedAt, new Date(Date.now() - 20_000)))))
    .orderBy(sql`${foxreloadQuotes.lastCheckedAt} ASC NULLS FIRST`, orders.createdAt, orders.id).limit(8);
  await Promise.allSettled(candidates.map((row) => syncCodeOrder(row.id, row.userId)));
  return candidates.length;
}
