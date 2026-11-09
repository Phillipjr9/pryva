import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { orders, users, walletTransactions } from "@/db/schema";
import type { Product } from "@/lib/services/foxreload/contract";
import { TELEGRAM_STARS_PRODUCT, priceStars } from "@/lib/services/foxreload/telegram-stars";

const mocks = vi.hoisted(() => ({ db: undefined as unknown, product: vi.fn(), create: vi.fn(), pay: vi.fn(), read: vi.fn(), find: vi.fn() }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/email/schedule-wallet-emails", () => ({ scheduleWalletEmails: vi.fn() }));
vi.mock("@/lib/checkout/purchase", () => ({ afterPurchase: vi.fn() }));
vi.mock("@/lib/providers/foxreload", () => ({ isFoxreloadConfigured: () => true, readFoxreloadProductContract: mocks.product, createFoxreloadContractOrder: mocks.create, payFoxreloadOrder: mocks.pay, readFoxreloadContractOrder: mocks.read, findFoxreloadOrderId: mocks.find }));

const USER = "11111111-1111-4111-8111-111111111111", OTHER = "11111111-1111-4111-8111-111111111112";
const REQUEST = "22222222-2222-4222-8222-222222222222", PROVIDER = "0199a1c2-3d4e-7f50-8a6b-7c8d9e0f1a00";
const PRODUCT: Product = { id: TELEGRAM_STARS_PRODUCT, name: "Telegram Stars", currency: "usd", unitPrice: "0.0155", deliveryType: "direct_topup", quantity: 10_000, minQuantity: 1, maxQuantity: 10_000, requiredNoteFields: ["username"], noteFieldTypes: { username: "string" }, noteFieldOptions: {} };
let supplierKey = "", recipient = "";
const providerOrder = (status: string, itemStatus: string) => ({ id: PROVIDER, idempotencyKey: supplierKey, isMock: false, currency: "usd", price: "1.5500", status, items: [{ product: { id: TELEGRAM_STARS_PRODUCT, deliveryType: "direct_topup" }, quantity: 100, note: { username: recipient }, fulfillmentStatus: itemStatus }] });
let pg: PGlite, database: PgliteDatabase<typeof schema>, service: typeof import("@/lib/services/foxreload/stars-orders");

beforeAll(async () => {
  pg = new PGlite();
  const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema }); mocks.db = database;
  service = await import("@/lib/services/foxreload/stars-orders");
}, 30_000);
afterAll(async () => { vi.unstubAllEnvs(); await pg?.close(); });
beforeEach(async () => {
  vi.clearAllMocks(); vi.stubEnv("FOXRELOAD_USD_NGN_RATE", "1500"); vi.stubEnv("FOXRELOAD_IS_MOCK", "false"); vi.stubEnv("FOXRELOAD_STARS_ENABLED", "true");
  mocks.find.mockResolvedValue(null); mocks.product.mockResolvedValue(PRODUCT);
  mocks.create.mockImplementation(async (input: { idempotencyKey: string; note: { username: string } }) => { supplierKey = input.idempotencyKey; recipient = input.note.username; return providerOrder("active", "active"); });
  mocks.pay.mockResolvedValue({}); mocks.read.mockImplementation(async () => providerOrder("completed", "completed"));
  await database.execute(sql`TRUNCATE TABLE foxreload_quotes, orders, wallet_transactions, users CASCADE`);
  for (const id of [USER, OTHER]) await database.insert(users).values({ id, name: "Ada", email: `${id}@example.test`, passwordHash: "x", walletBalance: 20_000 });
});
async function quote() { const result = await service.quoteTelegramStars(USER, 100); if (result.kind !== "quote") throw new Error("no quote"); return result; }
async function balance() { const [row] = await database.select({ balance: users.walletBalance }).from(users).where(eq(users.id, USER)); return row.balance; }

describe("Telegram Stars end-to-end order claims", () => {
  it("recovers a lost supplier ID by verified lookup without another create or payment", async () => {
    const q = await quote();
    mocks.create.mockImplementationOnce(async (input: { idempotencyKey: string }) => { supplierKey = input.idempotencyKey; recipient = "valid_user"; throw new Error("timeout"); });
    const result = await service.buyTelegramStars({ userId: USER, quoteId: q.id, requestId: REQUEST, username: "valid_user" });
    if (result.kind !== "order") throw new Error("order expected");
    expect(result.status).toBe("review"); expect((await database.select().from(orders))[0].providerRequestId).toBeNull();
    mocks.find.mockResolvedValue(PROVIDER);
    await service.syncTelegramStars(result.id, OTHER); expect(mocks.find).not.toHaveBeenCalled();
    mocks.read.mockResolvedValueOnce({ ...providerOrder("completed", "completed"), price: "999" });
    await service.syncTelegramStars(result.id, USER); expect((await database.select().from(orders))[0].providerRequestId).toBeNull();
    await database.update(schema.foxreloadQuotes).set({ lastCheckedAt: new Date(0) });
    mocks.read.mockResolvedValueOnce(providerOrder("completed", "completed"));
    expect(await service.sweepTelegramStars()).toBe(1);
    expect((await database.select().from(orders))[0]).toMatchObject({ status: "delivered", providerRequestId: PROVIDER });
    expect(mocks.find).toHaveBeenCalledWith(result.id); expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.pay).not.toHaveBeenCalled();
    expect((await database.select().from(walletTransactions)).filter((row) => row.type === "refund")).toHaveLength(0);
  });
  it("never pays a Stars order for the wrong recipient", async () => {
    const q = await quote();
    mocks.create.mockImplementationOnce(async (input: { idempotencyKey: string }) => { supplierKey = input.idempotencyKey; recipient = "wrong_recipient"; return providerOrder("active", "active"); });
    expect(await service.buyTelegramStars({ userId: USER, quoteId: q.id, requestId: REQUEST, username: "valid_user" })).toMatchObject({ status: "review" });
    expect(mocks.pay).not.toHaveBeenCalled();
  });
  it("uses exact retail pricing and requires an explicit FX rate", () => {
    expect(priceStars(PRODUCT, 100, { FOXRELOAD_USD_NGN_RATE: "1500" })).toEqual({ amount: 3255, wholesaleTotal: "1.5500" });
    expect(priceStars(PRODUCT, 100, {})).toBeNull();
    expect(priceStars({ ...PRODUCT, currency: "rub" }, 100, { FOXRELOAD_USD_NGN_RATE: "1500" })).toBeNull();
  });
  it("quotes, debits once, creates and pays with the correct username, and confirms delivery", async () => {
    const q = await quote();
    const result = await service.buyTelegramStars({ userId: USER, quoteId: q.id, requestId: REQUEST, username: "@monk_123" });
    expect(result).toMatchObject({ kind: "order", status: "delivered", replayed: false });
    expect(await balance()).toBe(16745);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ quantity: 100, note: { username: "monk_123" }, mock: false, idempotencyKey: expect.stringMatching(/^[a-f0-9-]{36}$/) }));
    expect(supplierKey).not.toBe(REQUEST);
    expect(mocks.pay).toHaveBeenCalledWith(PROVIDER);
    const again = await service.buyTelegramStars({ userId: USER, quoteId: q.id, requestId: REQUEST, username: "monk_123" });
    expect(again).toMatchObject({ kind: "order", replayed: true, status: "delivered" });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect((await database.select().from(walletTransactions)).filter((x) => x.type === "debit")).toHaveLength(1);
  });
  it("supports the documented one-Star product when the live note type map is empty", async () => {
    mocks.product.mockResolvedValue({ ...PRODUCT, name: "Telegram Stars 1", noteFieldTypes: {} });
    const q = await quote();
    expect(await service.buyTelegramStars({ userId: USER, quoteId: q.id, requestId: REQUEST, username: "valid_user" })).toMatchObject({ kind: "order", status: "delivered" });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ product: expect.objectContaining({ noteFieldTypes: { username: "string" } }) }));
  });
  it("does not infer username types for different products or conflicting contracts", () => {
    const env = { FOXRELOAD_USD_NGN_RATE: "1500" };
    expect(priceStars({ ...PRODUCT, name: "Telegram Stars 100", noteFieldTypes: {} }, 100, env)).toBeNull();
    expect(priceStars({ ...PRODUCT, id: "another", noteFieldTypes: {} }, 100, env)).toBeNull();
    expect(priceStars({ ...PRODUCT, noteFieldTypes: { username: "integer" } }, 100, env)).toBeNull();
    expect(priceStars({ ...PRODUCT, noteFieldTypes: {}, noteFieldOptions: { username: [{ label: "X", value: "x" }] } }, 100, env)).toBeNull();
    expect(priceStars({ ...PRODUCT, requiredNoteFields: ["username", "extra"], noteFieldTypes: {} }, 100, env)).toBeNull();
  });
  it("serializes concurrent retries to one debit and one supplier order", async () => {
    const q = await quote();
    const input = { userId: USER, quoteId: q.id, requestId: REQUEST, username: "valid_user" };
    const results = await Promise.all([service.buyTelegramStars(input), service.buyTelegramStars(input)]);
    expect(results.every((result) => result.kind === "order")).toBe(true);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.pay).toHaveBeenCalledTimes(1);
    expect((await database.select().from(walletTransactions)).filter((row) => row.type === "debit")).toHaveLength(1);
    expect(await balance()).toBe(16745);
  });
  it("refuses another user's quote, stale prices, and insufficient funds without a supplier order", async () => {
    const q = await quote();
    expect(await service.buyTelegramStars({ userId: OTHER, quoteId: q.id, requestId: REQUEST, username: "valid_user" })).toMatchObject({ kind: "error" });
    mocks.product.mockResolvedValueOnce({ ...PRODUCT, unitPrice: "0.0200" });
    expect(await service.buyTelegramStars({ userId: USER, quoteId: q.id, requestId: REQUEST, username: "valid_user" })).toMatchObject({ code: "changed" });
    await database.update(users).set({ walletBalance: 0 }).where(eq(users.id, USER));
    expect(await service.buyTelegramStars({ userId: USER, quoteId: q.id, requestId: REQUEST, username: "valid_user" })).toMatchObject({ code: "insufficient" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not pay if the created supplier order differs from the quote", async () => {
    const q = await quote(); mocks.create.mockImplementationOnce(async (input: { idempotencyKey: string }) => { supplierKey = input.idempotencyKey; return { ...providerOrder("active", "active"), price: "500" }; });
    expect(await service.buyTelegramStars({ userId: USER, quoteId: q.id, requestId: REQUEST, username: "valid_user" })).toMatchObject({ kind: "order", status: "review" });
    expect(mocks.pay).not.toHaveBeenCalled();
    const [row] = await database.select().from(orders);
    expect(row.providerRequestId).toBe(PROVIDER);
    expect(await balance()).toBe(16745);
  });
  it("retains uncertain purchases for review without retry or automatic refund", async () => {
    const q = await quote(); mocks.create.mockRejectedValueOnce(new Error("timeout"));
    const result = await service.buyTelegramStars({ userId: USER, quoteId: q.id, requestId: REQUEST, username: "valid_user" });
    expect(result).toMatchObject({ kind: "order", status: "review" });
    expect(await balance()).toBe(16745);
    await service.buyTelegramStars({ userId: USER, quoteId: q.id, requestId: REQUEST, username: "valid_user" });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.pay).not.toHaveBeenCalled();
    expect((await database.select().from(walletTransactions)).filter((x) => x.type === "refund")).toHaveLength(0);
  });
  it("keeps a lost payment response in review and does not send a second payment", async () => {
    const q = await quote(); mocks.pay.mockRejectedValueOnce(new Error("timeout"));
    const result = await service.buyTelegramStars({ userId: USER, quoteId: q.id, requestId: REQUEST, username: "valid_user" });
    expect(result).toMatchObject({ kind: "order", status: "review" });
    const again = await service.buyTelegramStars({ userId: USER, quoteId: q.id, requestId: REQUEST, username: "valid_user" });
    expect(again).toMatchObject({ kind: "order", replayed: true });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.pay).toHaveBeenCalledTimes(1);
    expect(await balance()).toBe(16745);
    const other = await quote();
    expect(await service.buyTelegramStars({ userId: USER, quoteId: other.id, requestId: "33333333-3333-4333-8333-333333333333", username: "valid_user" })).toMatchObject({ code: "pending" });
  });
  it("refuses new quotes when the feature gate is off", async () => {
    vi.stubEnv("FOXRELOAD_STARS_ENABLED", "false");
    expect(await service.quoteTelegramStars(USER, 100)).toMatchObject({ code: "unavailable" });
    expect(mocks.product).not.toHaveBeenCalled();
  });
  it("sweeps pending orders and prunes only unconsumed expired quotes", async () => {
    const q = await quote(); mocks.read.mockResolvedValueOnce(providerOrder("processing", "processing"));
    const result = await service.buyTelegramStars({ userId: USER, quoteId: q.id, requestId: REQUEST, username: "valid_user" });
    expect(result).toMatchObject({ status: "review" });
    await database.update(schema.foxreloadQuotes).set({ lastCheckedAt: new Date(0), expiresAt: new Date(0) }).where(eq(schema.foxreloadQuotes.id, q.id));
    const unused = await quote();
    await database.update(schema.foxreloadQuotes).set({ expiresAt: new Date(0) }).where(eq(schema.foxreloadQuotes.id, unused.id));
    expect(await service.sweepTelegramStars()).toBe(1);
    expect(await service.pruneTelegramQuotes()).toBe(1);
    const [order] = await database.select().from(orders);
    expect(order.status).toBe("delivered");
    expect(await database.select().from(schema.foxreloadQuotes)).toHaveLength(1);
  });
  it("does not claim delivery for a mock, mismatched or still-processing order", async () => {
    const q = await quote(); mocks.read.mockImplementationOnce(async () => ({ ...providerOrder("completed", "completed"), isMock: true }));
    const result = await service.buyTelegramStars({ userId: USER, quoteId: q.id, requestId: REQUEST, username: "valid_user" });
    expect(result).toMatchObject({ kind: "order", status: "review" });
    mocks.read.mockResolvedValueOnce(providerOrder("processing", "processing"));
    if (result.kind !== "order") throw new Error("missing order");
    await service.syncTelegramStars(result.id, USER);
    const [row] = await database.select().from(orders);
    expect(row.status).toBe("review");
  });
});
