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
 *   • uncertain provider outcomes must never be refunded or retried automatically;
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
  return boost.placeBoostOrder({
    userId: USER,
    itemId: LISTING.id,
    link: "https://instagram.com/ada",
    quantity: 1_000,
    requestId: REQUEST,
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

  it("holds an uncertain supplier outcome without retrying or refunding", async () => {
    mocks.add.mockRejectedValue(new Error("lost response"));
    const result = await place();
    expect(result.kind).toBe("pending");
    const state = await refundState();
    expect(state.order.status).toBe("review");
    expect(state.order.refundedAt).toBeNull();
    expect(state.moneyIsBack).toBe(false);
    expect(state.balance).toBe(23_500);
    expect((await place()).kind).toBe("replay");
    expect((await place({ requestId: "33333333-3333-4333-8333-333333333333" })).kind).toBe("pending");
    expect(mocks.add).toHaveBeenCalledTimes(1);
  });

  it("blocks concurrent requests while a supplier call is in flight", async () => {
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    mocks.add.mockImplementationOnce(async () => { entered(); await waiting; return { orderId: "panel-order-1" }; });
    const first = place();
    await started;
    expect((await place()).kind).toBe("replay");
    expect((await place({ requestId: "33333333-3333-4333-8333-333333333333" })).kind).toBe("pending");
    expect(mocks.add).toHaveBeenCalledOnce();
    release();
    expect((await first).kind).toBe("created");
    expect(await balance()).toBe(23_500);
  });

  it("binds a request ID to the original target and quantity", async () => {
    expect((await place()).kind).toBe("created");
    expect((await place({ link: "https://instagram.com/other" })).kind).toBe("invalid");
    expect((await place({ quantity: 2000 })).kind).toBe("invalid");
    expect(mocks.add).toHaveBeenCalledTimes(1);
  });

  it("replays an accepted order even when the supplier is offline", async () => {
    expect((await place()).kind).toBe("created");
    const smm = await import("@/lib/providers/smm-panel");
    const spy = vi.spyOn(smm, "isSmmPanelConfigured").mockReturnValue(false);
    expect((await place()).kind).toBe("replay");
    expect(mocks.add).toHaveBeenCalledOnce();
    spy.mockRestore();
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

  it("holds a durable claim if the provider boundary cannot be recorded", async () => {
    const state = { fired: false };
    mocks.db = flakyDatabase(state);
    try {
      expect((await place()).kind).toBe("pending");
      const saved = await refundState();
      expect(saved.moneyIsBack).toBe(false);
      expect(saved.order.status).toBe("review");
      expect(saved.balance).toBe(23_500);
      expect(mocks.add).not.toHaveBeenCalled();
    } finally { mocks.db = database; }
  });

  it("does not call the supplier when suspension wins after reservation", async () => {
    let transactions = 0;
    mocks.db = new Proxy(database, {
      get(target, property) {
        if (property === "transaction") return async (callback: (tx: unknown) => Promise<unknown>) => {
          const result = await target.transaction(callback);
          transactions++;
          if (transactions === 1) await target.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, USER));
          return result;
        };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    try {
      expect((await place()).kind).toBe("pending");
      expect(mocks.add).not.toHaveBeenCalled();
      const saved = await refundState();
      expect(saved.order.status).toBe("review");
      expect(saved.moneyIsBack).toBe(false);
      expect(saved.balance).toBe(23_500);
    } finally { mocks.db = database; }
  });

  it("does not charge a suspended account", async () => {
    await database.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, USER));
    await expect(place()).rejects.toThrow("not eligible");
    expect(mocks.add).not.toHaveBeenCalled();
    expect(await balance()).toBe(25_000);
    expect(await database.select().from(orders)).toHaveLength(0);
  });

  it("refuses an unpriced listing rather than guessing", async () => {
    mocks.find.mockResolvedValue({ listing: { ...LISTING, perThousand: null }, snapshot: {} });
    const result = await place();
    expect(result.kind).toBe("unavailable");
    expect(await database.select().from(orders)).toHaveLength(0);
  });
});
