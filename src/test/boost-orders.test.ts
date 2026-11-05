import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";

import * as schema from "@/db/schema";
import { orders, users, walletTransactions } from "@/db/schema";
import { publicBoostQuote } from "@/lib/services/boosts/boost-quote";
import { totalForQuantity } from "@/lib/services/boosts/boost-money";

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
vi.mock("@/lib/email/schedule-wallet-emails", () => ({ scheduleWalletEmails: vi.fn() }));
vi.mock("@/lib/services/boosts/smm-catalog", () => ({ findBoostListing: mocks.find }));
vi.mock("@/lib/providers/smm-panel", () => ({
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
let boost: typeof import("@/lib/services/boosts/boost-orders");

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
  boost = await import("@/lib/services/boosts/boost-orders");
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
  const quantity = overrides.quantity ?? 1_000;
  return boost.placeBoostOrder({
    userId: USER,
    itemId: LISTING.id,
    link: "https://instagram.com/ada",
    quantity,
    requestId: REQUEST,
    expectedTotalNgn: totalForQuantity(LISTING.perThousand, quantity) || 1,
    expectedTerms: publicBoostQuote(LISTING)!.terms,
    ...overrides,
  });
}

/**
 * A database whose first `update(orders)` call is refused.
 *
 * The refund used to be two commits — the credit in a transaction of its own,
 * the order status written after it. So "the money moved and then the write
 * failed" was a state a real outage could reach, and this is that failure
 * injected. Everything else passes through, including the transaction wrapper,
 * so the refusal lands wherever the code happens to write rather than where the
 * test happens to expect it.
 */
function flakyDatabase(state: { fired: boolean }) {
  const facade = (client: any): any => ({
    select: (...args: unknown[]) => client.select(...args),
    insert: (...args: unknown[]) => client.insert(...args),
    execute: (...args: unknown[]) => client.execute(...args),
    update: (table: unknown) => {
      if (table === orders && !state.fired) {
        state.fired = true;
        throw new Error("database write failed");
      }
      return client.update(table);
    },
    transaction: (callback: (tx: any) => unknown) =>
      client.transaction((tx: any) => callback(facade(tx))),
  });
  return facade(database);
}

async function refundState() {
  const [order] = await database.select().from(orders).where(eq(orders.userId, USER));
  const entries = await database.select().from(walletTransactions).where(eq(walletTransactions.userId, USER));
  return {
    order,
    moneyIsBack: entries.some((entry) => entry.type === "refund"),
    balance: await balance(),
  };
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
    expect((result as { error: string }).error).toContain("wallet has been refunded");
    expect((result as { error: string }).error).toContain("before placing another order");

    expect(await balance()).toBe(25_000);
    const [order] = await database.select().from(orders).where(eq(orders.userId, USER));
    expect(order.status).toBe("refunded");
    expect(order.refundedAt).not.toBeNull();

    // The ledger tells the whole story: a debit and its reversal.
    const entries = await database.select().from(walletTransactions).where(eq(walletTransactions.userId, USER));
    expect(entries.map((entry) => entry.type).sort()).toEqual(["debit", "refund"]);

    // The receipt nudge used to ride along with the standalone credit. Once the
    // refund commits inside a transaction, somebody has to call it on purpose.
    const { scheduleWalletEmails } = await import("@/lib/email/schedule-wallet-emails");
    expect(vi.mocked(scheduleWalletEmails)).toHaveBeenCalledTimes(1);
  });

  it("charges the server price only when it matches the amount reviewed", async () => {
    const result = await place({ quantity: 100 });
    expect(result.kind).toBe("created");
    const [order] = await database.select().from(orders).where(eq(orders.userId, USER));
    expect(order.amount).toBe(150); // 100 units at ₦1,500 / 1,000
  });

  it("requires a reviewed quote for a new order and rejects a tampered amount", async () => {
    expect((await place({ expectedTotalNgn: undefined, expectedTerms: undefined })).kind).toBe("quote_required");
    expect((await place({ expectedTotalNgn: 1 })).kind).toBe("quote_changed");
    expect(await balance()).toBe(25_000);
    expect(await database.select().from(orders)).toHaveLength(0);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("rechecks a changed price, requires another confirmation and charges the reviewed new total", async () => {
    const updated = { ...LISTING, perThousand: 2_100 };
    mocks.find.mockResolvedValue({ listing: updated, snapshot: {} });
    const changed = await place();
    expect(changed.kind).toBe("quote_changed");
    if (changed.kind !== "quote_changed") throw new Error("expected a changed quote");
    expect(changed.quote).toMatchObject({ perThousand: 2_100, min: 100, max: 50_000 });
    expect(changed.quote).not.toHaveProperty("serviceId");
    expect(changed.quote).not.toHaveProperty("currency");
    expect(await balance()).toBe(25_000);
    expect(await database.select().from(orders)).toHaveLength(0);
    expect(mocks.add).not.toHaveBeenCalled();

    const confirmed = await place({ expectedTotalNgn: 2_100, expectedTerms: changed.quote.terms });
    expect(confirmed.kind).toBe("created");
    expect(await balance()).toBe(22_900);
    const [order] = await database.select().from(orders);
    expect(order.amount).toBe(2_100);
    expect(mocks.add).toHaveBeenCalledTimes(1);
  });

  it("also requests review when visible terms or quantity bounds change at the same price", async () => {
    mocks.find.mockResolvedValue({ listing: { ...LISTING, name: "Instagram followers revised", min: 2_000 }, snapshot: {} });
    const result = await place();
    expect(result.kind).toBe("quote_changed");
    expect(mocks.add).not.toHaveBeenCalled();
    expect(await balance()).toBe(25_000);
  });

  it("replays an existing attempt even when configuration or price data is unavailable", async () => {
    expect((await place()).kind).toBe("created");
    const smm = await import("@/lib/providers/smm-panel");
    const spy = vi.spyOn(smm, "isSmmPanelConfigured").mockReturnValue(false);
    mocks.find.mockRejectedValue(new Error("catalog offline"));
    try {
      expect((await place({ expectedTotalNgn: undefined, expectedTerms: undefined })).kind).toBe("replay");
      expect((await place({ link: "https://instagram.com/other" })).kind).toBe("request_conflict");
      expect((await place({ quantity: 2_000 })).kind).toBe("request_conflict");
      expect(mocks.add).toHaveBeenCalledTimes(1);
      expect(await balance()).toBe(23_500);
    } finally { spy.mockRestore(); }
  });

  it("answers cleanly when nothing is configured to fulfil a boost", async () => {
    const smm = await import("@/lib/providers/smm-panel");
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

  describe("when the refund cannot be recorded", () => {
    it("keeps the money and the order record as one event", async () => {
      const state = { fired: false };
      mocks.db = flakyDatabase(state);
      mocks.add.mockRejectedValue(new Error("panel said no"));
      try {
        const result = await place();
        expect(result.kind).toBe("unavailable");
        expect((result as { error: string }).error).toContain("couldn't confirm your boost or its refund");
        expect((result as { error: string }).error).not.toContain("nothing was charged");
        expect((result as { error: string }).error).not.toContain("has been refunded");

        const { order, moneyIsBack, balance: wallet } = await refundState();
        // Either the customer has the money and the order says so, or nothing
        // moved and the row still reads `processing` for an operator to settle.
        // The state this rejects is the one the split left reachable: wallet
        // refunded, order insisting the refund failed, and nothing to tell the
        // next reader — or the admin refund screen — that it already happened.
        expect(moneyIsBack).toBe(order.refundedAt !== null);
        expect(order.status).toBe(moneyIsBack ? "refunded" : "processing");
        expect(wallet).toBe(moneyIsBack ? 25_000 : 23_500);
        expect(order.reconciliationNote).toContain("automatic refund could not be confirmed");
        expect(state.fired).toBe(true);
      } finally {
        mocks.db = database;
      }
    });
  });

  it("does not overwrite a refund if its commit acknowledgement is lost", async () => {
    let transactions = 0;
    mocks.db = {
      select: (...args: unknown[]) => (database.select as any)(...args),
      insert: (...args: unknown[]) => (database.insert as any)(...args),
      update: (...args: unknown[]) => (database.update as any)(...args),
      transaction: async (callback: (tx: any) => Promise<unknown>) => {
        transactions += 1;
        const result = await database.transaction(callback);
        if (transactions === 2) throw new Error("commit acknowledgement lost");
        return result;
      },
    };
    mocks.add.mockRejectedValue(new Error("supplier outcome unknown"));
    try {
      const result = await place();
      expect(result.kind).toBe("unavailable");
      expect((result as { error: string }).error).toContain("couldn't confirm your boost or its refund");
      expect((result as { error: string }).error).not.toContain("has been refunded");
      const { order, moneyIsBack, balance: wallet } = await refundState();
      expect(moneyIsBack).toBe(true);
      expect(order.status).toBe("refunded");
      expect(order.refundedAt).not.toBeNull();
      expect(order.reconciliationNote).not.toContain("automatic refund could not be confirmed");
      expect(wallet).toBe(25_000);
    } finally {
      mocks.db = database;
    }
  });

  it("refuses an unpriced listing rather than guessing", async () => {
    mocks.find.mockResolvedValue({ listing: { ...LISTING, perThousand: null }, snapshot: {} });
    const result = await place();
    expect(result.kind).toBe("unavailable");
    expect(await database.select().from(orders)).toHaveLength(0);
  });
});
