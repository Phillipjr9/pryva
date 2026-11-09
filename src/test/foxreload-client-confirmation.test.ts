import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { topupIntent } from "@/lib/services/foxreload/topup-offers";

const mocks = vi.hoisted(() => ({ db: undefined as unknown, read: vi.fn(), submit: vi.fn() }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/email/schedule-wallet-emails", () => ({ scheduleWalletEmails: vi.fn() }));
vi.mock("@/lib/checkout/purchase", () => ({ afterPurchase: vi.fn() }));
vi.mock("@/lib/providers/foxreload", async (original) => {
  const real = await original<typeof import("@/lib/providers/foxreload")>();
  return { ...real, isFoxreloadConfigured: () => true, readFoxreloadContractOrder: mocks.read, submitFoxreloadClientCode: mocks.submit };
});
const USER = "11111111-1111-4111-8111-111111111111", OTHER = "11111111-1111-4111-8111-111111111112";
const ORDER = "22222222-2222-4222-8222-222222222222", QUOTE = "33333333-3333-4333-8333-333333333333";
const PROVIDER = "44444444-4444-4444-8444-444444444444", ITEM = "55555555-5555-4555-8555-555555555555";
const PRODUCT = "product_01kj6xhpn3e29bcw1n69p5mwc5", note = { username: "buyer123" };
const raw = () => ({ id: PROVIDER, idempotencyKey: ORDER, isMock: false, currency: "usd", price: "1.5500", status: "action_required", items: [{ id: ITEM, product: { id: PRODUCT, deliveryType: "direct_topup" }, quantity: 1, note, fulfillmentStatus: "action_required" }] });
let pg: PGlite, database: PgliteDatabase<typeof schema>, service: typeof import("@/lib/services/foxreload/client-confirmation");
beforeAll(async () => {
  pg = new PGlite();
  for (const file of (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema }); mocks.db = database;
  service = await import("@/lib/services/foxreload/client-confirmation");
}, 30_000);
afterAll(async () => { vi.unstubAllEnvs(); await pg?.close(); });
beforeEach(async () => {
  vi.clearAllMocks(); vi.stubEnv("FOXRELOAD_CLIENT_CODES_ENABLED", "true"); vi.stubEnv("FOXRELOAD_INTENT_SECRET", "01234567890123456789012345678901");
  await database.execute(sql`TRUNCATE TABLE foxreload_quotes, orders, wallet_transactions, users CASCADE`);
  for (const id of [USER, OTHER]) await database.insert(schema.users).values({ id, name: "Buyer", email: `${id}@example.test`, passwordHash: "x", walletBalance: 10000 });
  await database.insert(schema.orders).values({ id: ORDER, userId: USER, reference: "TOPUP-TEST", requestId: "66666666-6666-4666-8666-666666666666", requestIntent: topupIntent(USER, QUOTE, note), service: "subscriptions", productSlug: "direct-topup", productName: "Top-up", planLabel: "1 unit", region: "US", duration: "Digital", quantity: 1, amount: 3255, status: "review", provider: "foxreload", providerRequestId: PROVIDER });
  await database.insert(schema.foxreloadQuotes).values({ id: QUOTE, userId: USER, orderId: ORDER, productId: PRODUCT, productName: "fingerprint", quantity: 1, wholesaleTotal: "1.5500", currency: "usd", amount: 3255, expiresAt: new Date(Date.now() + 10000) });
  mocks.read.mockResolvedValue(raw()); mocks.submit.mockResolvedValue({});
});
describe("buyer confirmation codes", () => {
  it("is disabled by default, owner-only and refuses mismatched supplier orders", async () => {
    vi.stubEnv("FOXRELOAD_CLIENT_CODES_ENABLED", "false"); expect(await service.inspectClientConfirmation(USER, ORDER)).toEqual({ kind: "unavailable" });
    vi.stubEnv("FOXRELOAD_CLIENT_CODES_ENABLED", "true"); expect(await service.inspectClientConfirmation(OTHER, ORDER)).toEqual({ kind: "not-found" });
    for (const altered of [ { ...raw(), isMock: true }, { ...raw(), status: "processing" }, { ...raw(), price: "3.00" }, { ...raw(), items: [{ ...raw().items[0], note: { username: "other" } }] }, { ...raw(), items: [{ ...raw().items[0], id: "invalid" }] } ]) {
      mocks.read.mockResolvedValueOnce(altered); expect(await service.inspectClientConfirmation(USER, ORDER)).toEqual({ kind: "not-needed" });
    }
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it("submits once with a durable claim and never stores the confirmation code", async () => {
    expect(await service.inspectClientConfirmation(USER, ORDER)).toMatchObject({ kind: "waiting" });
    expect(await service.submitClientConfirmation(USER, ORDER, "CODE-7788")).toBe("submitted");
    expect(mocks.submit).toHaveBeenCalledWith(PROVIDER, ITEM, "CODE-7788");
    const [order] = await database.select().from(schema.orders); const [q] = await database.select().from(schema.foxreloadQuotes);
    expect(order.status).toBe("review"); expect(q.clientCodeState).toBe("submitted");
    expect(JSON.stringify([order, q])).not.toContain("CODE-7788");
    expect(await service.submitClientConfirmation(USER, ORDER, "CODE-7788")).toBe("unavailable"); expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it("allows a fresh code only after explicit provider rejection", async () => {
    const { FoxreloadError } = await import("@/lib/providers/foxreload");
    mocks.submit.mockRejectedValueOnce(new FoxreloadError("Rejected", 400, "ORDER_ITEM_CLIENT_CODE_REJECTED"));
    expect(await service.submitClientConfirmation(USER, ORDER, "OLD-CODE")).toBe("rejected");
    expect((await database.select().from(schema.foxreloadQuotes))[0].clientCodeState).toBeNull();
    expect(await service.submitClientConfirmation(USER, ORDER, "NEW-CODE")).toBe("submitted"); expect(mocks.submit).toHaveBeenCalledTimes(2);
  });
  it("blocks further codes after timeout and does not issue refunds", async () => {
    mocks.submit.mockRejectedValueOnce(new Error("timeout"));
    expect(await service.submitClientConfirmation(USER, ORDER, "CODE")).toBe("uncertain");
    expect(await service.inspectClientConfirmation(USER, ORDER)).toEqual({ kind: "blocked" });
    expect(await service.submitClientConfirmation(USER, ORDER, "CODE2")).toBe("unavailable");
    expect((await database.select().from(schema.walletTransactions))).toHaveLength(0);
  });
  it("claims processing before network I/O to prevent concurrent submissions or refunds", async () => {
    let finish!: () => void; let started!: () => void;
    const running = new Promise<void>((resolve) => { started = resolve; });
    mocks.submit.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; started(); }));
    const first = service.submitClientConfirmation(USER, ORDER, "CODE"); await running;
    expect((await database.select().from(schema.orders).where(eq(schema.orders.id, ORDER)))[0].status).toBe("processing");
    expect(await service.submitClientConfirmation(USER, ORDER, "CODE2")).toBe("unavailable");
    finish(); expect(await first).toBe("submitted"); expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
});
