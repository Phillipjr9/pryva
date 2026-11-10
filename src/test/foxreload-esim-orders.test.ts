import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { orders, users, walletTransactions } from "@/db/schema";
import type { Product } from "@/lib/services/foxreload/contract";
import { approvedEsimOffers, priceEsim, publicEsimId } from "@/lib/services/foxreload/esim-offers";

const mocks = vi.hoisted(() => ({ db: undefined as unknown, product: vi.fn(), create: vi.fn(), pay: vi.fn(), read: vi.fn(), find: vi.fn() }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/email/schedule-wallet-emails", () => ({ scheduleWalletEmails: vi.fn() }));
vi.mock("@/lib/checkout/purchase", () => ({ afterPurchase: vi.fn() }));
vi.mock("@/lib/providers/foxreload", () => ({ isFoxreloadConfigured: () => true, readFoxreloadProductContract: mocks.product, createFoxreloadContractOrder: mocks.create, payFoxreloadOrder: mocks.pay, readFoxreloadContractOrder: mocks.read, findFoxreloadOrderId: mocks.find }));
const USER = "11111111-1111-4111-8111-111111111111", OTHER = "11111111-1111-4111-8111-111111111112";
const REQUEST = "22222222-2222-4222-8222-222222222222", PROVIDER = "0199a1c2-3d4e-7f50-8a6b-7c8d9e0f1a00";
const OFFER = { id: "product_01kj6xhpn3e29bcw1n69p5mwc5", name: "Sample travel eSIM", region: "US", terms: "One GB for seven days; US coverage.", countryCode: "US", marketRegion: null };
const PRODUCT: Product = { id: OFFER.id, name: OFFER.name, currency: "usd", unitPrice: "1.5500", deliveryType: "esim", quantity: 50, countryCode: "US", marketRegion: null, minQuantity: 1, maxQuantity: 1, requiredNoteFields: [], noteFieldTypes: {}, noteFieldOptions: {} };
let supplierKey = "";
const providerOrder = (status: string, itemStatus: string, externalData: string[] = []) => ({ id: PROVIDER, idempotencyKey: supplierKey, isMock: false, currency: "usd", price: "1.5500", status, items: [{ product: { id: OFFER.id, deliveryType: "esim" }, quantity: 1, fulfillmentStatus: itemStatus, externalData, externalId: "8944000000000000001" }] });
let pg: PGlite, database: PgliteDatabase<typeof schema>, service: typeof import("@/lib/services/foxreload/esim-orders");
beforeAll(async () => {
  pg = new PGlite();
  const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema }); mocks.db = database;
  service = await import("@/lib/services/foxreload/esim-orders");
}, 30_000);
afterAll(async () => { vi.unstubAllEnvs(); await pg?.close(); });
beforeEach(async () => {
  vi.clearAllMocks(); vi.stubEnv("FOXRELOAD_USD_NGN_RATE", "1500"); vi.stubEnv("FOXRELOAD_IS_MOCK", "false"); vi.stubEnv("FOXRELOAD_ESIMS_ENABLED", "true"); vi.stubEnv("FOXRELOAD_ESIM_OFFERS", JSON.stringify([OFFER]));
  mocks.find.mockResolvedValue(null); mocks.product.mockResolvedValue(PRODUCT);
  mocks.create.mockImplementation(async (input: { idempotencyKey: string }) => { supplierKey = input.idempotencyKey; return providerOrder("active", "active"); });
  mocks.pay.mockResolvedValue({}); mocks.read.mockImplementation(async () => providerOrder("completed", "completed", ["LPA:1$rsp.example$SECRET"]));
  await database.execute(sql`TRUNCATE TABLE foxreload_quotes, orders, wallet_transactions, users CASCADE`);
  for (const id of [USER, OTHER]) await database.insert(users).values({ id, name: "Ada", email: `${id}@example.test`, passwordHash: "x", walletBalance: 20_000 });
});
async function quote() { const result = await service.quoteEsim(USER, publicEsimId(OFFER.id)); if (result.kind !== "quote") throw new Error("no quote"); return result; }
async function balance() { const [row] = await database.select({ balance: users.walletBalance }).from(users).where(eq(users.id, USER)); return row.balance; }
describe("reviewed FoxReload eSIM orders", () => {
  it("requires explicit region-specific operator approval and exact USD pricing", () => {
    expect(approvedEsimOffers({})).toEqual([]);
    expect(approvedEsimOffers({ FOXRELOAD_ESIM_OFFERS: JSON.stringify([OFFER, OFFER]) })).toEqual([]);
    expect(approvedEsimOffers({ FOXRELOAD_ESIM_OFFERS: JSON.stringify([{ ...OFFER, region: "" }]) })).toEqual([]);
    expect(priceEsim(PRODUCT, OFFER, { FOXRELOAD_USD_NGN_RATE: "1500" })).toEqual({ amount: 3255, wholesaleTotal: "1.5500" });
    for (const changed of [{ currency: "rub" }, { deliveryType: "banking_card" as const }, { deliveryType: "direct_topup" as const }, { quantity: 0 }, { requiredNoteFields: ["login"] }, { name: "wrong" }, { countryCode: "GB" }, { marketRegion: undefined }]) expect(priceEsim({ ...PRODUCT, ...changed }, OFFER, { FOXRELOAD_USD_NGN_RATE: "1500" })).toBeNull();
    expect(priceEsim(PRODUCT, OFFER, {})).toBeNull();
  });
  it("quotes, atomically debits once, creates, pays and stores one confirmed profile only on its order", async () => {
    const q = await quote(); expect(q).toMatchObject({ amount: 3255, region: "US", name: OFFER.name });
    const result = await service.buyEsim({ userId: USER, quoteId: q.id, requestId: REQUEST });
    expect(result).toMatchObject({ kind: "order", status: "delivered" });
    expect(await balance()).toBe(16745);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ quantity: 1, note: {}, mock: false }));
    expect(supplierKey).not.toBe(REQUEST); expect(mocks.pay).toHaveBeenCalledTimes(1);
    const [saved] = await database.select().from(orders); expect(saved.esimActivationCode).toBe("LPA:1$rsp.example$SECRET");
    expect(JSON.stringify(result)).not.toContain("LPA:1$rsp.example$SECRET");
    const again = await service.buyEsim({ userId: USER, quoteId: q.id, requestId: REQUEST }); expect(again).toMatchObject({ replayed: true, status: "delivered" });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect((await database.select().from(walletTransactions)).filter((x) => x.type === "debit")).toHaveLength(1);
  });
  it("serializes concurrent retries and never charges twice", async () => {
    const q = await quote(); const input = { userId: USER, quoteId: q.id, requestId: REQUEST };
    const results = await Promise.all([service.buyEsim(input), service.buyEsim(input)]);
    expect(results.every((x) => x.kind === "order")).toBe(true); expect(await balance()).toBe(16745); expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.pay).toHaveBeenCalledTimes(1);
  });
  it("refuses cross-user, changed price or terms, and insufficient funds", async () => {
    const q = await quote();
    expect(await service.buyEsim({ userId: OTHER, quoteId: q.id, requestId: REQUEST })).toMatchObject({ code: "changed" });
    mocks.product.mockResolvedValueOnce({ ...PRODUCT, unitPrice: "2" });
    expect(await service.buyEsim({ userId: USER, quoteId: q.id, requestId: REQUEST })).toMatchObject({ code: "changed" });
    vi.stubEnv("FOXRELOAD_ESIM_OFFERS", JSON.stringify([{ ...OFFER, terms: "Changed coverage" }]));
    expect(await service.buyEsim({ userId: USER, quoteId: q.id, requestId: REQUEST })).toMatchObject({ code: "changed" });
    vi.stubEnv("FOXRELOAD_ESIM_OFFERS", JSON.stringify([OFFER]));
    await database.update(users).set({ walletBalance: 0 }).where(eq(users.id, USER));
    expect(await service.buyEsim({ userId: USER, quoteId: q.id, requestId: REQUEST })).toMatchObject({ code: "insufficient" }); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("refuses a changed or invalid exchange rate before wallet debit", async () => {
    const q = await quote();
    vi.stubEnv("FOXRELOAD_USD_NGN_RATE", "1600");
    expect(await service.buyEsim({ userId: USER, quoteId: q.id, requestId: REQUEST })).toMatchObject({ code: "changed" });
    vi.stubEnv("FOXRELOAD_USD_NGN_RATE", "invalid");
    expect(await service.buyEsim({ userId: USER, quoteId: q.id, requestId: REQUEST })).toMatchObject({ code: "changed" });
    expect(await balance()).toBe(20_000); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("never pays a mismatched supplier order", async () => {
    const q = await quote(); mocks.create.mockImplementationOnce(async (input: { idempotencyKey: string }) => { supplierKey = input.idempotencyKey; return { ...providerOrder("active", "active"), price: "500" }; });
    expect(await service.buyEsim({ userId: USER, quoteId: q.id, requestId: REQUEST })).toMatchObject({ status: "review" }); expect(mocks.pay).not.toHaveBeenCalled();
    const [row] = await database.select().from(orders); expect(row.providerRequestId).toBe(PROVIDER); expect(await balance()).toBe(16745);
  });
  it("keeps uncertain create or pay outcomes for review, with no blind retry or refund", async () => {
    const q = await quote(); mocks.pay.mockRejectedValueOnce(new Error("timeout"));
    expect(await service.buyEsim({ userId: USER, quoteId: q.id, requestId: REQUEST })).toMatchObject({ status: "review" });
    expect(await service.buyEsim({ userId: USER, quoteId: q.id, requestId: REQUEST })).toMatchObject({ replayed: true });
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.pay).toHaveBeenCalledTimes(1);
    expect((await database.select().from(walletTransactions)).filter((x) => x.type === "refund")).toHaveLength(0);
    const next = await quote(); expect(await service.buyEsim({ userId: USER, quoteId: next.id, requestId: "33333333-3333-4333-8333-333333333333" })).toMatchObject({ code: "pending" });
  });
  it("does not deliver mocks, partial results, multiple profiles, or inconsistent item states", async () => {
    const q = await quote(); mocks.read.mockImplementationOnce(() => ({ ...providerOrder("completed", "completed", ["LPA:1$rsp.example$FAKE"]), isMock: true }));
    const result = await service.buyEsim({ userId: USER, quoteId: q.id, requestId: REQUEST }); expect(result).toMatchObject({ status: "review" });
    if (result.kind !== "order") throw new Error("order expected");
    for (const raw of [providerOrder("completed", "processing", ["LPA:1$rsp.example$FAKE"]), providerOrder("completed", "completed", ["LPA:1$rsp.example$ONE", "LPA:1$rsp.example$TWO"]), providerOrder("completed", "completed", []), { ...providerOrder("completed", "completed", ["LPA:1$rsp.example$FAKE"]), items: [{ ...providerOrder("completed", "completed", ["LPA:1$rsp.example$FAKE"]).items[0], externalId: "invalid" }] }, providerOrder("completed", "completed", ["https://example.test/activation"])]) {
      await database.update(schema.foxreloadQuotes).set({ lastCheckedAt: new Date(0) }); mocks.read.mockResolvedValueOnce(raw); await service.syncEsimOrder(result.id, USER);
      const [row] = await database.select().from(orders); expect(row.status).toBe("review"); expect(row.esimActivationCode).toBeNull();
    }
  });
  it("recovers a lost supplier ID by verified lookup without another create or payment", async () => {
    const q = await quote();
    mocks.create.mockImplementationOnce(async (input: { idempotencyKey: string }) => { supplierKey = input.idempotencyKey;  throw new Error("timeout"); });
    const result = await service.buyEsim({ userId: USER, quoteId: q.id, requestId: REQUEST });
    if (result.kind !== "order") throw new Error("order expected");
    expect(result.status).toBe("review"); expect((await database.select().from(orders))[0].providerRequestId).toBeNull();
    mocks.find.mockResolvedValue(PROVIDER);
    await service.syncEsimOrder(result.id, OTHER); expect(mocks.find).not.toHaveBeenCalled();
    mocks.read.mockResolvedValueOnce({ ...providerOrder("completed", "completed", ["LPA:1$rsp.example$SECRET"]), price: "999" });
    await service.syncEsimOrder(result.id, USER); expect((await database.select().from(orders))[0].providerRequestId).toBeNull();
    await database.update(schema.foxreloadQuotes).set({ lastCheckedAt: new Date(0) });
    mocks.read.mockResolvedValueOnce(providerOrder("completed", "completed", ["LPA:1$rsp.example$SECRET"]));
    expect(await service.sweepEsimOrders()).toBe(1);
    expect((await database.select().from(orders))[0]).toMatchObject({ status: "delivered", providerRequestId: PROVIDER });
    expect(mocks.find).toHaveBeenCalledWith(result.id); expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.pay).not.toHaveBeenCalled();
    expect((await database.select().from(walletTransactions)).filter((row) => row.type === "refund")).toHaveLength(0);
  });
  it("keeps recovery working after disabling new sales and protects another user's order", async () => {
    const q = await quote(); mocks.read.mockResolvedValueOnce(providerOrder("processing", "processing"));
    const result = await service.buyEsim({ userId: USER, quoteId: q.id, requestId: REQUEST }); if (result.kind !== "order") throw new Error("order expected");
    vi.stubEnv("FOXRELOAD_ESIMS_ENABLED", "false"); expect(await service.quoteEsim(USER, publicEsimId(OFFER.id))).toMatchObject({ code: "unavailable" });
    await database.update(schema.foxreloadQuotes).set({ lastCheckedAt: new Date(0) }); await service.syncEsimOrder(result.id, OTHER);
    expect((await database.select().from(orders))[0].status).toBe("review");
    expect(await service.sweepEsimOrders()).toBe(1); expect((await database.select().from(orders))[0].status).toBe("delivered");
  });
});
