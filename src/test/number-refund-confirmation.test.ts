import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { SINGLE_NUMBER_WINDOW } from "@/lib/services/refund-policy";

const mocks = vi.hoisted(() => ({ db: null as unknown, activation: vi.fn(), cancel: vi.fn() }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/providers/bitcall", async (original) => ({ ...(await original<typeof import("@/lib/providers/bitcall")>()), getBitcallOtpActivation: mocks.activation }));
vi.mock("@/lib/services/fulfillment", () => ({ cancelUpstream: mocks.cancel }));
let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let processAutoRefunds: typeof import("@/lib/services/auto-refund").processAutoRefunds;
const USER = "11111111-1111-4111-8111-111111111111";

beforeAll(async () => {
  pg = new PGlite();
  for (const file of (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema }); mocks.db = database;
  await database.insert(schema.users).values({ id: USER, name: "Test", email: "buyer@example.test", passwordHash: "hash", walletBalance: 10000 });
  ({ processAutoRefunds } = await import("@/lib/services/auto-refund"));
}, 60000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  vi.clearAllMocks(); mocks.cancel.mockResolvedValue(true);
  await database.delete(schema.walletTransactions); await database.delete(schema.orders);
  await database.update(schema.users).set({ walletBalance: 10000 }).where(eq(schema.users.id, USER));
});
async function order(overrides: Partial<typeof schema.orders.$inferInsert> = {}) {
  const [row] = await database.insert(schema.orders).values({
    userId: USER, reference: "TEST-REFUND", service: "numbers", productSlug: "vn-ng", productName: "Number", planLabel: "Single", region: "Nigeria",
    duration: SINGLE_NUMBER_WINDOW, amount: 1000, status: "active", provider: "bitcall", providerRequestId: "activation-1", createdAt: new Date(Date.now() - 600000), ...overrides,
  }).returning();
  await database.insert(schema.walletTransactions).values({ userId: USER, orderId: row.id, type: "debit", amount: row.amount, balanceAfter: 10000, description: "Fixture", reference: "FIX-DEBIT" });
  return row;
}
const activation = (status: string, code: string | null = null) => ({ status, code });

describe("final number delivery confirmation", () => {
  it("saves a code found after the window and does not refund", async () => {
    await order(); mocks.activation.mockResolvedValue(activation("received", "123456"));
    expect(await processAutoRefunds()).toEqual({ refunded: 0, cancelled: 0 });
    expect((await database.select().from(schema.orders))[0]).toMatchObject({ status: "delivered", otpCode: "123456" });
    expect((await database.select().from(schema.walletTransactions)).filter((entry) => entry.type === "refund")).toHaveLength(0);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it.each(["pending", "delivered", "unknown"])("does not refund an unconfirmed %s outcome", async (status) => {
    await order(); mocks.activation.mockResolvedValue(activation(status));
    expect(await processAutoRefunds()).toEqual({ refunded: 0, cancelled: 0 });
    expect((await database.select().from(schema.orders))[0].status).toBe("active");
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it("does not refund if the provider cannot be read or the reference is missing", async () => {
    await order(); mocks.activation.mockRejectedValue(new Error("offline"));
    expect(await processAutoRefunds()).toEqual({ refunded: 0, cancelled: 0 });
    await database.update(schema.orders).set({ providerRequestId: null });
    mocks.activation.mockClear();
    expect(await processAutoRefunds()).toEqual({ refunded: 0, cancelled: 0 });
    expect(mocks.activation).not.toHaveBeenCalled();
  });
  it("rotates past 100 unconfirmed candidates so later orders are not starved", async () => {
    const createdAt = new Date(Date.now() - 600000);
    const rows = await database.insert(schema.orders).values(Array.from({ length: 101 }, (_, i) => ({
      userId: USER, reference: `FAIR-${i}`, service: "numbers" as const, productSlug: "vn-ng", productName: "Number", planLabel: "Single", region: "NG",
      duration: SINGLE_NUMBER_WINDOW, amount: 1000, status: "active", provider: "bitcall", providerRequestId: `activation-${i}`,
      createdAt: new Date(createdAt.getTime() + i),
    }))).returning();
    await database.insert(schema.walletTransactions).values({ userId: USER, orderId: rows[100].id, type: "debit", amount: 1000, balanceAfter: 10000, description: "Fixture", reference: "FAIR-DEBIT" });
    mocks.activation.mockImplementation(async (id: string) => activation(id === "activation-100" ? "expired" : "pending"));
    expect(await processAutoRefunds()).toEqual({ refunded: 0, cancelled: 0 });
    expect(await processAutoRefunds()).toEqual({ refunded: 1, cancelled: 1 });
    expect((await database.select().from(schema.orders).where(eq(schema.orders.id, rows[100].id)))[0].status).toBe("refunded");
  });
  it("does not create money for an uncharged claimed order", async () => {
    await order();
    await database.delete(schema.walletTransactions);
    mocks.activation.mockResolvedValue(activation("expired"));
    expect(await processAutoRefunds()).toEqual({ refunded: 0, cancelled: 0 });
    expect((await database.select().from(schema.orders))[0].status).toBe("active");
    expect((await database.select().from(schema.users))[0].walletBalance).toBe(10000);
  });
  it.each(["expired", "cancelled"])("refunds a confirmed %s outcome once", async (status) => {
    await order({ status: "expired" }); mocks.activation.mockResolvedValue(activation(status));
    expect(await processAutoRefunds()).toEqual({ refunded: 1, cancelled: 1 });
    expect(await processAutoRefunds()).toEqual({ refunded: 0, cancelled: 0 });
    expect((await database.select().from(schema.users))[0].walletBalance).toBe(11000);
    expect((await database.select().from(schema.walletTransactions)).filter((entry) => entry.type === "refund")).toHaveLength(1);
  });
});
