import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { orders, users, walletTransactions } from "@/db/schema";
import { parseProduct, type Product } from "@/lib/services/foxreload/contract";
import { approvedTopupOffers, publicTopupId, topupPrice, type TopupOffer } from "@/lib/services/foxreload/topup-offers";
const mocks = vi.hoisted(() => ({ db: undefined as unknown, product: vi.fn(), create: vi.fn(), pay: vi.fn(), read: vi.fn() }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/email/schedule-wallet-emails", () => ({ scheduleWalletEmails: vi.fn() }));
vi.mock("@/lib/checkout/purchase", () => ({ afterPurchase: vi.fn() }));
vi.mock("@/lib/providers/foxreload", () => ({ isFoxreloadConfigured: () => true, readFoxreloadProductContract: mocks.product, createFoxreloadContractOrder: mocks.create, payFoxreloadOrder: mocks.pay, readFoxreloadContractOrder: mocks.read }));
const USER = "11111111-1111-4111-8111-111111111111", OTHER = "11111111-1111-4111-8111-111111111112";
const REQUEST = "22222222-2222-4222-8222-222222222222", PROVIDER = "0199a1c2-3d4e-7f50-8a6b-7c8d9e0f1a00";
const OFFER: TopupOffer = { id: "product_01kj6xhpn3e29bcw1n69p5mwc5", name: "Game top-up", region: "US", terms: "Only for US accounts.", countryCode: "US", marketRegion: null, min: 1, max: 10, fields: [{ key: "player_id", label: "Player ID" }, { key: "server", label: "Server" }] };
const PRODUCT: Product = { id: OFFER.id, name: OFFER.name, currency: "usd", unitPrice: "1.5500", deliveryType: "direct_topup", quantity: 50, countryCode: "US", marketRegion: null, minQuantity: 1, maxQuantity: 10, requiredNoteFields: ["player_id", "server"], noteFieldTypes: { server: "string" }, noteFieldOptions: {} };
const NOTE = { player_id: "player-123", server: "us-east" };
let supplierKey = "", suppliedNote = NOTE;
const providerOrder = (status: string, itemStatus: string) => ({ id: PROVIDER, idempotencyKey: supplierKey, isMock: false, currency: "usd", price: "3.1000", status, items: [{ product: { id: OFFER.id, deliveryType: "direct_topup" }, quantity: 2, note: suppliedNote, fulfillmentStatus: itemStatus }] });
let pg: PGlite, database: PgliteDatabase<typeof schema>, service: typeof import("@/lib/services/foxreload/topup-orders");
beforeAll(async () => {
  pg = new PGlite();
  const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema }); mocks.db = database;
  service = await import("@/lib/services/foxreload/topup-orders");
}, 30_000);
afterAll(async () => { vi.unstubAllEnvs(); await pg?.close(); });
beforeEach(async () => {
  vi.clearAllMocks(); vi.stubEnv("FOXRELOAD_USD_NGN_RATE", "1500"); vi.stubEnv("FOXRELOAD_IS_MOCK", "false"); vi.stubEnv("FOXRELOAD_TOPUPS_ENABLED", "true"); vi.stubEnv("FOXRELOAD_TOPUP_OFFERS", JSON.stringify([OFFER])); vi.stubEnv("FOXRELOAD_INTENT_SECRET", "01234567890123456789012345678901");
  suppliedNote = NOTE; mocks.product.mockResolvedValue(PRODUCT);
  mocks.create.mockImplementation(async (input: { idempotencyKey: string; note: typeof NOTE }) => { supplierKey = input.idempotencyKey; suppliedNote = input.note; return providerOrder("active", "active"); });
  mocks.pay.mockResolvedValue({}); mocks.read.mockImplementation(async () => providerOrder("completed", "completed"));
  await database.execute(sql`TRUNCATE TABLE foxreload_quotes, orders, wallet_transactions, users CASCADE`);
  for (const id of [USER, OTHER]) await database.insert(users).values({ id, name: "Ada", email: `${id}@example.test`, passwordHash: "x", walletBalance: 20_000 });
});
async function quote() { const result = await service.quoteTopup(USER, publicTopupId(OFFER.id), 2); if (result.kind !== "quote") throw new Error("no quote"); return result; }
async function balance() { const [row] = await database.select({ balance: users.walletBalance }).from(users).where(eq(users.id, USER)); return row.balance; }
describe("reviewed direct top-ups", () => {
  it("rejects unsafe fields, unknown delivery and incorrect product or currency", () => {
    expect(approvedTopupOffers({})).toEqual([]);
    expect(approvedTopupOffers({ FOXRELOAD_TOPUP_OFFERS: JSON.stringify([{ ...OFFER, terms: "" }]) })).toEqual([]);
    expect(approvedTopupOffers({ FOXRELOAD_TOPUP_OFFERS: JSON.stringify([{ ...OFFER, fields: [{ key: "password", label: "Password" }] }]) })).toEqual([]);
    expect(approvedTopupOffers({ FOXRELOAD_TOPUP_OFFERS: JSON.stringify([OFFER, OFFER]) })).toEqual([]);
    expect(topupPrice(PRODUCT, OFFER, 2, { FOXRELOAD_USD_NGN_RATE: "1500" })).toEqual({ amount: 6510, wholesaleTotal: "3.1000" });
    for (const changed of [{ currency: "rub" }, { deliveryType: "login_topup" as const }, { deliveryType: "banking_card" as const }, { quantity: 1 }, { countryCode: "GB" }, { requiredNoteFields: ["player_id"] }, { noteFieldTypes: { player_id: "integer" as const } }, { noteFieldOptions: { player_id: [{ value: "a", label: "A" }] } }]) expect(topupPrice({ ...PRODUCT, ...changed }, OFFER, 2, { FOXRELOAD_USD_NGN_RATE: "1500" })).toBeNull();
    expect(topupPrice(PRODUCT, OFFER, 11, { FOXRELOAD_USD_NGN_RATE: "1500" })).toBeNull();
    expect(topupPrice(PRODUCT, OFFER, 2, {})).toBeNull();
  });
  it("accepts the documented account_id shape for a reviewed Mobile Legends offer", () => {
    const raw = { id: "product_01ktef9ah9f01shkej8ynenshd", name: "Mobile Legends 565 Diamonds (Россия)", currency: "rub", price: "1043.04", deliveryType: "direct_topup", quantity: 2000300, orderMinQuantity: 1, orderMaxQuantity: 1, attributes: { country_code: "RU" }, requiredNoteFields: ["account_id", "server_id"], noteFieldTypes: { account_id: "string", server_id: "string" }, noteFieldOptions: {} };
    const offer: TopupOffer = { id: raw.id, name: raw.name, region: "Russia", terms: "For accounts in Russia only.", countryCode: "RU", marketRegion: null, min: 1, max: 1, fields: [{ key: "account_id", label: "Account ID" }, { key: "server_id", label: "Server ID" }] };
    expect(approvedTopupOffers({ FOXRELOAD_TOPUP_OFFERS: JSON.stringify([offer]) })).toEqual([offer]);
    // The public RUB response must never be treated as USD. The USD case below
    // is synthetic and is not proof of this account's live price or inventory.
    expect(topupPrice(parseProduct(raw)!, offer, 1, { FOXRELOAD_USD_NGN_RATE: "1500" })).toBeNull();
    expect(topupPrice(parseProduct({ ...raw, currency: "usd", price: "1.5500" })!, offer, 1, { FOXRELOAD_USD_NGN_RATE: "1500" })).toEqual({ amount: 3255, wholesaleTotal: "1.5500" });
  });
  it("quotes, debits once, verifies the recipient and confirms the matching supplier delivery", async () => {
    const q = await quote(); expect(q).toMatchObject({ amount: 6510, region: "US", quantity: 2, fields: OFFER.fields });
    const result = await service.buyTopup({ userId: USER, quoteId: q.id, requestId: REQUEST, note: NOTE });
    expect(result).toMatchObject({ kind: "order", status: "delivered" }); expect(await balance()).toBe(13490);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ quantity: 2, note: NOTE, mock: false })); expect(supplierKey).not.toBe(REQUEST); expect(mocks.pay).toHaveBeenCalledTimes(1);
    const [saved] = await database.select().from(orders); expect(JSON.stringify(saved)).not.toContain("player-123");
    const [storedQuote] = await database.select().from(schema.foxreloadQuotes); expect(storedQuote.customerTerms).toBe("Only for US accounts.");
    expect(await service.buyTopup({ userId: USER, quoteId: q.id, requestId: REQUEST, note: NOTE })).toMatchObject({ replayed: true, status: "delivered" });
    expect(await service.buyTopup({ userId: USER, quoteId: q.id, requestId: REQUEST, note: { ...NOTE, player_id: "different" } })).toMatchObject({ code: "invalid" });
    expect(mocks.create).toHaveBeenCalledTimes(1); expect((await database.select().from(walletTransactions)).filter((x) => x.type === "debit")).toHaveLength(1);
  });
  it("serializes concurrent retries with one wallet debit and supplier order", async () => {
    const q = await quote(); const input = { userId: USER, quoteId: q.id, requestId: REQUEST, note: NOTE };
    const results = await Promise.all([service.buyTopup(input), service.buyTopup(input)]); expect(results.every((x) => x.kind === "order")).toBe(true);
    expect(await balance()).toBe(13490); expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.pay).toHaveBeenCalledTimes(1);
  });
  it("refuses other users, changed terms, price, recipient fields and insufficient funds", async () => {
    const q = await quote();
    expect(await service.buyTopup({ userId: OTHER, quoteId: q.id, requestId: REQUEST, note: NOTE })).toMatchObject({ code: "changed" });
    expect(await service.buyTopup({ userId: USER, quoteId: q.id, requestId: REQUEST, note: { ...NOTE, password: "secret" } })).toMatchObject({ code: "invalid" });
    mocks.product.mockResolvedValueOnce({ ...PRODUCT, unitPrice: "2" });
    expect(await service.buyTopup({ userId: USER, quoteId: q.id, requestId: REQUEST, note: NOTE })).toMatchObject({ code: "changed" });
    vi.stubEnv("FOXRELOAD_TOPUP_OFFERS", JSON.stringify([{ ...OFFER, terms: "Excludes US" }]));
    expect(await service.buyTopup({ userId: USER, quoteId: q.id, requestId: REQUEST, note: NOTE })).toMatchObject({ code: "changed" });
    vi.stubEnv("FOXRELOAD_TOPUP_OFFERS", JSON.stringify([OFFER]));
    await database.update(users).set({ walletBalance: 0 }).where(eq(users.id, USER));
    expect(await service.buyTopup({ userId: USER, quoteId: q.id, requestId: REQUEST, note: NOTE })).toMatchObject({ code: "insufficient" }); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not pay if the supplier order reports another target", async () => {
    const q = await quote(); mocks.create.mockImplementationOnce(async (input: { idempotencyKey: string }) => { supplierKey = input.idempotencyKey; suppliedNote = { ...NOTE, player_id: "wrong" }; return providerOrder("active", "active"); });
    expect(await service.buyTopup({ userId: USER, quoteId: q.id, requestId: REQUEST, note: NOTE })).toMatchObject({ status: "review" }); expect(mocks.pay).not.toHaveBeenCalled();
    const [row] = await database.select().from(orders); expect(row.providerRequestId).toBe(PROVIDER); expect(await balance()).toBe(13490);
  });
  it("keeps an uncertain payment for review and never retries or refunds blindly", async () => {
    const q = await quote(); mocks.pay.mockRejectedValueOnce(new Error("timeout"));
    expect(await service.buyTopup({ userId: USER, quoteId: q.id, requestId: REQUEST, note: NOTE })).toMatchObject({ status: "review" });
    expect(await service.buyTopup({ userId: USER, quoteId: q.id, requestId: REQUEST, note: NOTE })).toMatchObject({ replayed: true });
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.pay).toHaveBeenCalledTimes(1); expect((await database.select().from(walletTransactions)).filter((x) => x.type === "refund")).toHaveLength(0);
  });
  it("refuses to mark mismatched recipients, mocks, and partial orders delivered", async () => {
    const q = await quote(); mocks.read.mockImplementationOnce(() => ({ ...providerOrder("completed", "completed"), isMock: true }));
    const result = await service.buyTopup({ userId: USER, quoteId: q.id, requestId: REQUEST, note: NOTE }); if (result.kind !== "order") throw new Error("order expected"); expect(result.status).toBe("review");
    for (const raw of [providerOrder("completed", "processing"), { ...providerOrder("completed", "completed"), items: [{ ...providerOrder("completed", "completed").items[0], note: { ...NOTE, server: "wrong" } }] }]) {
      await database.update(schema.foxreloadQuotes).set({ lastCheckedAt: new Date(0) }); mocks.read.mockResolvedValueOnce(raw); await service.syncTopupOrder(result.id, USER);
      expect((await database.select().from(orders))[0].status).toBe("review");
    }
  });
  it("requires a stable recovery secret and allows status recovery after new sales are disabled", async () => {
    vi.stubEnv("FOXRELOAD_INTENT_SECRET", "short"); expect(await service.quoteTopup(USER, publicTopupId(OFFER.id), 2)).toMatchObject({ code: "unavailable" });
    vi.stubEnv("FOXRELOAD_INTENT_SECRET", "01234567890123456789012345678901"); const q = await quote(); mocks.read.mockResolvedValueOnce(providerOrder("processing", "processing"));
    const result = await service.buyTopup({ userId: USER, quoteId: q.id, requestId: REQUEST, note: NOTE }); if (result.kind !== "order") throw new Error("order expected");
    vi.stubEnv("FOXRELOAD_TOPUPS_ENABLED", "false"); await database.update(schema.foxreloadQuotes).set({ lastCheckedAt: new Date(0) }); await service.syncTopupOrder(result.id, OTHER);
    expect((await database.select().from(orders))[0].status).toBe("review"); expect(await service.sweepTopupOrders()).toBe(1); expect((await database.select().from(orders))[0].status).toBe("delivered");
  });
});
