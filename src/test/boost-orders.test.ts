import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";

import * as schema from "@/db/schema";
import { orders, users, walletTransactions } from "@/db/schema";

/**
 * Buying a boost spends wallet money against a supplier with no idempotency key
 * and no reliable release, so the failure modes are the interesting part:
 *
 *   • a retried request must replay the first order, never place a second;
 *   • a supplier that refuses must leave the customer exactly as they were;
 *   • a quantity the supplier will not accept must never reach the supplier;
 *   • the price must come from the server's catalogue, not the request.
 */

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  add: vi.fn(),
  find: vi.fn(),
}));

vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/schedule-wallet-emails", () => ({ scheduleWalletEmails: vi.fn() }));
vi.mock("@/lib/smm-catalog", () => ({ findBoostListing: mocks.find }));
vi.mock("@/lib/smm-panel", () => ({
  isSmmPanelConfigured: () => true,
  addSmmOrder: mocks.add,
  SmmPanelError: class SmmPanelError extends Error {
    constructor(message: string, public readonly status = 502, public readonly code?: string) {
      super(message);
      this.name = "SmmPanelError";
    }
  },
}));

const USER = "11111111-1111-4111-8111-111111111111";
const REQUEST = "22222222-2222-4222-8222-222222222222";

let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let boost: typeof import("@/lib/boost-orders");

const LISTING = {
  id: "live-boost-0123456789abcdef0123",
  serviceId: "svc-101",
  name: "Instagram Followers",
  tag: "Followers",
  platform: "Instagram",
  artwork: { kind: "brand" as const, name: "instagram" as const },
  perThousand: 1_500,
  min: 100,
  max: 50_000,
  currency: "NGN" as const,
};

beforeAll(async () => {
  pg = new PGlite();
  const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema });
  mocks.db = database;
  boost = await import("@/lib/boost-orders");
}, 30_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.find.mockResolvedValue({ listing: LISTING, snapshot: {} });
  mocks.add.mockResolvedValue({ orderId: "panel-order-1" });
  await database.execute(sql`TRUNCATE TABLE orders, wallet_transactions, users CASCADE`);
  await database.insert(users).values({
    id: USER,
    name: "Ada",
    email: "ada@example.com",
    passwordHash: "x",
    walletBalance: 25_000,
  });
});

async function balance(): Promise<number> {
  const [row] = await database.select({ balance: users.walletBalance }).from(users).where(eq(users.id, USER));
  return row!.balance;
}

function place(overrides: Partial<Parameters<typeof boost.placeBoostOrder>[0]> = {}) {
  return boost.placeBoostOrder({
    userId: USER,
    itemId: LISTING.id,
    link: "https://instagram.com/ada",
    quantity: 1_000,
    requestId: REQUEST,
    ...overrides,
  });
}

describe("placing a boost", () => {
  it("charges the server's price and tells the supplier once", async () => {
    const result = await place();
    expect(result.kind).toBe("created");
    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(mocks.add).toHaveBeenCalledWith({
      service: "svc-101",
      link: "https://instagram.com/ada",
      quantity: 1_000,
    });

    const [order] = await database.select().from(orders).where(eq(orders.userId, USER));
    expect(order).toMatchObject({
      amount: 1_500, // 1,000 units at ₦1,500 per 1,000
      status: "active",
      provider: "smm",
      providerRequestId: "panel-order-1",
      service: "social",
      targetLink: "https://instagram.com/ada",
      quantity: 1_000,
      productName: "Instagram Followers",
    });
    expect(await balance()).toBe(23_500);
  });

  it("replays the first order for a retried request instead of charging twice", async () => {
    const first = await place();
    const second = await place();

    expect(first.kind).toBe("created");
    expect(second.kind).toBe("replay");
    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(await database.select().from(orders)).toHaveLength(1);
    expect(await balance()).toBe(23_500);
  });

  it("refuses a quantity the supplier will not accept, without charging", async () => {
    for (const quantity of [0, -5, 1.5, 99, 50_001]) {
      const result = await place({ quantity });
      expect(result.kind, `quantity ${quantity}`).toBe("invalid");
    }
    expect(mocks.add).not.toHaveBeenCalled();
    expect(await balance()).toBe(25_000);
    expect(await database.select().from(orders)).toHaveLength(0);
  });

  it("refuses when the wallet cannot cover it", async () => {
    await database.update(users).set({ walletBalance: 500 }).where(eq(users.id, USER));
    const result = await place();
    expect(result.kind).toBe("insufficient");
    expect(mocks.add).not.toHaveBeenCalled();
    expect(await database.select().from(orders)).toHaveLength(0);
    expect(await balance()).toBe(500);
  });

  it("refunds in full when the supplier refuses, and says so", async () => {
    mocks.add.mockRejectedValue(new Error("panel said no"));
    const result = await place();
    expect(result.kind).toBe("unavailable");
    expect((result as { error: string }).error).toContain("nothing was charged");

    expect(await balance()).toBe(25_000);
    const [order] = await database.select().from(orders).where(eq(orders.userId, USER));
    expect(order.status).toBe("refunded");
    expect(order.refundedAt).not.toBeNull();

    // The ledger tells the whole story: a debit and its reversal.
    const entries = await database.select().from(walletTransactions).where(eq(walletTransactions.userId, USER));
    expect(entries.map((entry) => entry.type).sort()).toEqual(["debit", "refund"]);
  });

  it("never trusts a price the browser sends", async () => {
    // The only price in play is the server's listing: there is no parameter for
    // it, and a cheap listing still charges what the catalogue says.
    const result = await place({ quantity: 100 });
    expect(result.kind).toBe("created");
    const [order] = await database.select().from(orders).where(eq(orders.userId, USER));
    expect(order.amount).toBe(150); // 100 units at ₦1,500 / 1,000
  });

  it("answers cleanly when nothing is configured to fulfil a boost", async () => {
    const smm = await import("@/lib/smm-panel");
    const spy = vi.spyOn(smm, "isSmmPanelConfigured").mockReturnValue(false);
    const result = await place();
    expect(result.kind).toBe("disabled");
    expect(mocks.add).not.toHaveBeenCalled();
    expect(await database.select().from(orders)).toHaveLength(0);
    expect(await balance()).toBe(25_000);
    spy.mockRestore();
  });

  it("survives a catalogue read that throws", async () => {
    mocks.find.mockRejectedValue(new Error("panel unreachable"));
    const result = await place();
    expect(result.kind).toBe("invalid");
    expect(await database.select().from(orders)).toHaveLength(0);
  });

  it("treats a listing that is no longer for sale as invalid", async () => {
    mocks.find.mockResolvedValue(null);
    const result = await place();
    expect(result.kind).toBe("invalid");
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("refuses an unpriced listing rather than guessing", async () => {
    mocks.find.mockResolvedValue({ listing: { ...LISTING, perThousand: null }, snapshot: {} });
    const result = await place();
    expect(result.kind).toBe("unavailable");
    expect(await database.select().from(orders)).toHaveLength(0);
  });
});
