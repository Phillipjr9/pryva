import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { orders, users, walletTransactions } from "@/db/schema";
import { parseProduct, type Product } from "@/lib/services/foxreload/contract";
import { approvedTopupOffers, publicTopupId, topupPrice, type TopupOffer } from "@/lib/services/foxreload/topup-offers";
const mocks = vi.hoisted(() => ({ db: undefined as unknown, product: vi.fn(), create: vi.fn(), pay: vi.fn(), read: vi.fn(), find: vi.fn(), submit: vi.fn(), funds: vi.fn() }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/email/schedule-wallet-emails", () => ({ scheduleWalletEmails: vi.fn() }));
vi.mock("@/lib/checkout/purchase", () => ({ afterPurchase: vi.fn() }));
vi.mock("@/lib/providers/foxreload", () => ({ isFoxreloadConfigured: () => true, hasFoxreloadUsdFunds: mocks.funds, readFoxreloadProductContract: mocks.product, createFoxreloadContractOrder: mocks.create, payFoxreloadOrder: mocks.pay, readFoxreloadContractOrder: mocks.read, findFoxreloadOrderId: mocks.find, submitFoxreloadClientCode: mocks.submit, FoxreloadError: class extends Error { status = 500; code = "unknown"; } }));
const USER = "11111111-1111-4111-8111-111111111111", OTHER = "11111111-1111-4111-8111-111111111112";
const REQUEST = "22222222-2222-4222-8222-222222222222", PROVIDER = "0199a1c2-3d4e-7f50-8a6b-7c8d9e0f1a00";
const OFFER: TopupOffer = { id: "product_01kj6xhpn3e29bcw1n69p5mwc5", name: "Game top-up", region: "US", terms: "Only for US accounts.", countryCode: "US", marketRegion: null, min: 1, max: 10, fields: [{ key: "player_id", label: "Player ID" }, { key: "server", label: "Server" }] };
const PRODUCT: Product = { id: OFFER.id, name: OFFER.name, currency: "usd", unitPrice: "1.5500", deliveryType: "direct_topup", quantity: 50, countryCode: "US", marketRegion: null, minQuantity: 1, maxQuantity: 10, requiredNoteFields: ["player_id", "server"], noteFieldTypes: { server: "string" }, noteFieldOptions: {} };
const NOTE = { player_id: "player-123", server: "us-east" };
let supplierKey = "", suppliedNote: Record<string, string | number> = NOTE;
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
  vi.clearAllMocks(); vi.stubEnv("FOXRELOAD_USD_NGN_RATE", "1500"); vi.stubEnv("FOXRELOAD_IS_MOCK", "false"); vi.stubEnv("FOXRELOAD_TOPUPS_ENABLED", "true"); vi.stubEnv("FOXRELOAD_LOGIN_TOPUPS_ENABLED", "false"); vi.stubEnv("FOXRELOAD_TOPUP_OFFERS", JSON.stringify([OFFER])); vi.stubEnv("FOXRELOAD_INTENT_SECRET", "01234567890123456789012345678901");
  suppliedNote = NOTE; mocks.product.mockResolvedValue(PRODUCT); mocks.funds.mockResolvedValue(true);
  mocks.create.mockImplementation(async (input: { idempotencyKey: string; note: Record<string, string | number> }) => { supplierKey = input.idempotencyKey; suppliedNote = input.note; return providerOrder("active", "active"); });
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
  it("quotes and fulfills a reviewed non-secret login top-up with an account confirmation", async () => {
    // Shape based on a public Brawl Stars listing; USD price is a synthetic test fixture.
    const offer: TopupOffer = { id: "product_01m11dxkvsfkvrfhvjqpdfs9e3", name: "Brawl Stars Upgrade BP Direct Top Up (GLOBAL)", region: "Global", terms: "Signs in to the email account; confirmation may be required.", countryCode: "WW", marketRegion: null, min: 1, max: 1, deliveryType: "login_topup", fields: [{ key: "login", label: "Account email", type: "email" }] };
    const product: Product = { id: offer.id, name: offer.name, currency: "usd", unitPrice: "1.5500", deliveryType: "login_topup", quantity: 100, countryCode: "WW", marketRegion: null, minQuantity: 1, maxQuantity: 1, requiredNoteFields: ["login"], noteFieldTypes: { login: "email" }, noteFieldOptions: {} };
    vi.stubEnv("FOXRELOAD_TOPUP_OFFERS", JSON.stringify([offer])); mocks.product.mockResolvedValue(product);
    expect(await service.quoteTopup(USER, publicTopupId(offer.id), 1)).toMatchObject({ code: "unavailable" });
    vi.stubEnv("FOXRELOAD_LOGIN_TOPUPS_ENABLED", "true"); vi.stubEnv("FOXRELOAD_CLIENT_CODES_ENABLED", "true");
    const q = await service.quoteTopup(USER, publicTopupId(offer.id), 1); if (q.kind !== "quote") throw new Error("quote expected");
    expect(q).toMatchObject({ amount: 3255, deliveryType: "login_topup", fields: offer.fields });
    const login = { login: "buyer@example.test" }, itemId = "55555555-5555-4555-8555-555555555555";
    const provider = (status: string, itemStatus: string) => ({ id: PROVIDER, idempotencyKey: supplierKey, isMock: false, currency: "usd", price: "1.5500", status, items: [{ id: itemId, product: { id: offer.id, deliveryType: "login_topup" }, quantity: 1, note: login, fulfillmentStatus: itemStatus }] });
    mocks.create.mockImplementationOnce(async (input: { idempotencyKey: string }) => { supplierKey = input.idempotencyKey; return provider("active", "active"); });
    mocks.read.mockImplementation(async () => provider("action_required", "action_required")); mocks.submit.mockResolvedValue({});
    const result = await service.buyTopup({ userId: USER, quoteId: q.id, requestId: REQUEST, note: login });
    if (result.kind !== "order") throw new Error("order expected"); expect(result.status).toBe("review"); expect(mocks.pay).toHaveBeenCalledTimes(1);
    const confirmation = await import("@/lib/services/foxreload/client-confirmation");
    expect(await confirmation.inspectClientConfirmation(USER, result.id)).toMatchObject({ kind: "waiting" });
    expect(await confirmation.submitClientConfirmation(USER, result.id, "CODE123")).toBe("submitted");
    expect(mocks.submit).toHaveBeenCalledWith(PROVIDER, itemId, "CODE123");
    await database.update(schema.foxreloadQuotes).set({ lastCheckedAt: new Date(0) }); mocks.read.mockResolvedValueOnce(provider("completed", "completed"));
    await service.syncTopupOrder(result.id, USER); const [saved] = await database.select().from(orders);
    expect(saved).toMatchObject({ status: "delivered", productSlug: "login-topup" });
    expect(JSON.stringify(saved)).not.toMatch(/CODE123|buyer@example/); expect(await balance()).toBe(16745);
  });
  it("supports explicitly reviewed numeric, email and select fields without losing typed intent", async () => {
    const options = [{ value: "na", label: "North America" }, { value: "eu", label: "Europe" }];
    const offer: TopupOffer = { ...OFFER, fields: [{ key: "uid", label: "User ID", type: "integer" }, { key: "server", label: "Server", type: "select", options }, { key: "email", label: "Email", type: "email" }, { key: "zone_id", label: "Zone", type: "number" }] };
    const product: Product = { ...PRODUCT, requiredNoteFields: ["uid", "server", "email", "zone_id"], noteFieldTypes: { uid: "integer", server: "select", email: "email", zone_id: "number" }, noteFieldOptions: { server: options } };
    vi.stubEnv("FOXRELOAD_TOPUP_OFFERS", JSON.stringify([offer])); mocks.product.mockResolvedValue(product);
    expect(approvedTopupOffers({ FOXRELOAD_TOPUP_OFFERS: JSON.stringify([offer]) })).toEqual([offer]);
    expect(topupPrice(product, offer, 2, { FOXRELOAD_USD_NGN_RATE: "1500" })).toEqual({ amount: 6510, wholesaleTotal: "3.1000" });
    expect(topupPrice({ ...product, noteFieldOptions: { server: [{ value: "na", label: "Wrong" }] } }, offer, 2, { FOXRELOAD_USD_NGN_RATE: "1500" })).toBeNull();
    expect(topupPrice({ ...product, noteFieldTypes: { ...product.noteFieldTypes, uid: "string" } }, offer, 2, { FOXRELOAD_USD_NGN_RATE: "1500" })).toBeNull();
    const q = await service.quoteTopup(USER, publicTopupId(offer.id), 2); if (q.kind !== "quote") throw new Error("quote expected");
    const note = { uid: 123, server: "eu", email: "buyer@example.test", zone_id: 1.5 };
    for (const bad of [{ ...note, uid: "123" }, { ...note, uid: 1.2 }, { ...note, server: "unknown" }, { ...note, email: "bad" }, { ...note, zone_id: Infinity }]) {
      expect(await service.buyTopup({ userId: USER, quoteId: q.id, requestId: REQUEST, note: bad })).toMatchObject({ code: "invalid" });
      expect(mocks.create).not.toHaveBeenCalled(); expect(await balance()).toBe(20000);
    }
    const result = await service.buyTopup({ userId: USER, quoteId: q.id, requestId: REQUEST, note });
    expect(result).toMatchObject({ kind: "order", status: "delivered" });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ note }));
    expect(await service.buyTopup({ userId: USER, quoteId: q.id, requestId: REQUEST, note })).toMatchObject({ replayed: true });
    expect(await service.buyTopup({ userId: USER, quoteId: q.id, requestId: REQUEST, note: { ...note, uid: 124 } })).toMatchObject({ code: "invalid" });
    const [saved] = await database.select().from(orders); expect(JSON.stringify(saved)).not.toContain("buyer@example.test");
  });
  it("rejects malformed, duplicate and unapproved field choices", () => {
    const mk = (field: unknown) => ({ FOXRELOAD_TOPUP_OFFERS: JSON.stringify([{ ...OFFER, fields: [field] }]) });
    for (const field of [
      { key: "password", label: "Password", type: "string" },
      { key: "server", label: "Server", type: "select", options: [] },
      { key: "server", label: "Server", type: "select", options: [{ value: "a", label: "A" }, { value: "a", label: "Again" }] },
      { key: "server", label: "Server", type: "string", options: [{ value: "a", label: "A" }] },
      { key: "uid", label: "UID", type: "boolean" },
    ]) expect(approvedTopupOffers(mk(field))).toEqual([]);
  });
  it("does not debit customers when supplier funds are missing, insufficient or unreadable", async () => {
    const q = await quote();
    for (const answer of [false, new Error("unavailable")]) {
      if (answer instanceof Error) mocks.funds.mockRejectedValueOnce(answer); else mocks.funds.mockResolvedValueOnce(answer);
      expect(await service.buyTopup({ userId: USER, quoteId: q.id, requestId: REQUEST, note: NOTE })).toMatchObject({ code: "unavailable" });
      expect(await balance()).toBe(20000); expect(mocks.create).not.toHaveBeenCalled();
      expect((await database.select().from(walletTransactions)).filter((x) => x.type === "debit")).toHaveLength(0);
    }
    expect(mocks.funds).toHaveBeenCalledWith("3.1000");
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
  it("refuses a changed or invalid exchange rate before wallet debit", async () => {
    const q = await quote();
    vi.stubEnv("FOXRELOAD_USD_NGN_RATE", "1600");
    expect(await service.buyTopup({ userId: USER, quoteId: q.id, requestId: REQUEST, note: NOTE })).toMatchObject({ code: "changed" });
    vi.stubEnv("FOXRELOAD_USD_NGN_RATE", "invalid");
    expect(await service.buyTopup({ userId: USER, quoteId: q.id, requestId: REQUEST, note: NOTE })).toMatchObject({ code: "changed" });
    expect(await balance()).toBe(20_000); expect(mocks.create).not.toHaveBeenCalled();
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
  it("recovers a lost supplier ID by verified lookup without another create or payment", async () => {
    const q = await quote();
    mocks.create.mockImplementationOnce(async (input: { idempotencyKey: string }) => { supplierKey = input.idempotencyKey; suppliedNote = NOTE; throw new Error("timeout"); });
    const result = await service.buyTopup({ userId: USER, quoteId: q.id, requestId: REQUEST, note: NOTE });
    if (result.kind !== "order") throw new Error("order expected");
    expect(result.status).toBe("review"); expect((await database.select().from(orders))[0].providerRequestId).toBeNull();
    mocks.find.mockResolvedValue(PROVIDER);
    await service.syncTopupOrder(result.id, OTHER); expect(mocks.find).not.toHaveBeenCalled();
    mocks.read.mockResolvedValueOnce({ ...providerOrder("completed", "completed"), price: "999" });
    await service.syncTopupOrder(result.id, USER); expect((await database.select().from(orders))[0].providerRequestId).toBeNull();
    await database.update(schema.foxreloadQuotes).set({ lastCheckedAt: new Date(0) });
    mocks.read.mockResolvedValueOnce(providerOrder("completed", "completed"));
    expect(await service.sweepTopupOrders()).toBe(1);
    expect((await database.select().from(orders))[0]).toMatchObject({ status: "delivered", providerRequestId: PROVIDER });
    expect(mocks.find).toHaveBeenCalledWith(result.id); expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.pay).not.toHaveBeenCalled();
    expect((await database.select().from(walletTransactions)).filter((row) => row.type === "refund")).toHaveLength(0);
  });
  it("requires a stable recovery secret and allows status recovery after new sales are disabled", async () => {
    vi.stubEnv("FOXRELOAD_INTENT_SECRET", "short"); expect(await service.quoteTopup(USER, publicTopupId(OFFER.id), 2)).toMatchObject({ code: "unavailable" });
    vi.stubEnv("FOXRELOAD_INTENT_SECRET", "01234567890123456789012345678901"); const q = await quote(); mocks.read.mockResolvedValueOnce(providerOrder("processing", "processing"));
    const result = await service.buyTopup({ userId: USER, quoteId: q.id, requestId: REQUEST, note: NOTE }); if (result.kind !== "order") throw new Error("order expected");
    vi.stubEnv("FOXRELOAD_TOPUPS_ENABLED", "false"); await database.update(schema.foxreloadQuotes).set({ lastCheckedAt: new Date(0) }); await service.syncTopupOrder(result.id, OTHER);
    expect((await database.select().from(orders))[0].status).toBe("review"); expect(await service.sweepTopupOrders()).toBe(1); expect((await database.select().from(orders))[0].status).toBe("delivered");
  });
});
