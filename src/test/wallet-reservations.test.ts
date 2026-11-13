import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

/**
 * Wallet holds, against embedded PostgreSQL — the real unique index, the real
 * CHECK constraints and the real row-level arbitration, with no supplier and no
 * production record anywhere near it.
 *
 * What these pin, in the order the invariant depends on them:
 *
 *   • a hold moves exactly the reserved amount, once, and refuses when the
 *     wallet cannot cover it;
 *   • concurrent requests can only spend what one wallet holds — the race that
 *     used to let two orders pass the same balance check;
 *   • a settle writes one debit and one ledger row and cannot be repeated;
 *   • a release returns the money exactly once, and only from `held`;
 *   • an interrupted attempt (crash between reserve and settle) leaves funds the
 *     customer cannot spend, which is visible and is never auto-released;
 *   • `review` is terminal until an operator decides.
 */

const mocks = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));

const USER = "11111111-1111-4111-8111-111111111111";
let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let reservations: typeof import("@/lib/payments/reservations");

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "postgres://embedded-test/db");
  vi.stubEnv("VERCEL_ENV", "");
  pg = new PGlite();
  const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema });
  mocks.db = database;
  reservations = await import("@/lib/payments/reservations");
}, 30_000);

afterAll(async () => {
  await pg?.close();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  await pg.exec('TRUNCATE TABLE "users" CASCADE');
  await database.insert(schema.users).values({
    id: USER,
    name: "Buyer",
    email: "buyer@example.com",
    passwordHash: "hash",
    walletBalance: 50_000,
  });
});

async function account() {
  const [row] = await database
    .select({ balance: schema.users.walletBalance, reserved: schema.users.walletReserved })
    .from(schema.users)
    .where(eq(schema.users.id, USER));
  return row;
}

async function holds() {
  return database.select().from(schema.walletReservations);
}

function reserve(overrides: Partial<Parameters<typeof reservations.reserveWallet>[0]> = {}) {
  return reservations.reserveWallet({
    userId: USER,
    requestId: randomUUID(),
    service: "esim",
    amount: 9_800,
    fingerprint: "esim:v1:offer:9800",
    ...overrides,
  });
}

describe("reserving", () => {
  it("commits exactly the price, without touching the ledger balance", async () => {
    const result = await reserve();
    expect(result.kind).toBe("reserved");
    // The balance is the ledger's figure and stays put; the commitment is what
    // makes 9,800 of it unspendable.
    expect(await account()).toEqual({ balance: 50_000, reserved: 9_800 });
    expect(await reservations.availableBalance(USER)).toBe(40_200);
    const [hold] = await holds();
    expect(hold).toMatchObject({ userId: USER, service: "esim", amount: 9_800, status: "held" });
  });

  it("refuses when the wallet cannot cover the price, and moves nothing", async () => {
    await database.update(schema.users).set({ walletBalance: 1_000 }).where(eq(schema.users.id, USER));
    const result = await reserve();
    expect(result).toEqual({ kind: "insufficient", balance: 1_000 });
    expect(await account()).toEqual({ balance: 1_000, reserved: 0 });
    expect(await holds()).toHaveLength(0);
  });

  it("refuses a second hold the wallet cannot cover after the first", async () => {
    await database.update(schema.users).set({ walletBalance: 15_000 }).where(eq(schema.users.id, USER));
    expect((await reserve()).kind).toBe("reserved");
    const second = await reserve({ requestId: randomUUID(), amount: 9_800 });
    expect(second).toEqual({ kind: "insufficient", balance: 5_200 });
    expect(await holds()).toHaveLength(1);
    expect(await account()).toEqual({ balance: 15_000, reserved: 9_800 });
  });

  it("replays the same attempt key instead of reserving twice", async () => {
    const requestId = randomUUID();
    const first = await reserve({ requestId });
    const second = await reserve({ requestId });
    expect(first.kind).toBe("reserved");
    expect(second).toMatchObject({ kind: "existing", status: "held", reservationId: (first as { reservationId: string }).reservationId });
    expect(await account()).toEqual({ balance: 50_000, reserved: 9_800 });
    expect(await holds()).toHaveLength(1);
  });

  it("refuses to reuse an attempt key for different goods", async () => {
    const requestId = randomUUID();
    await reserve({ requestId });
    const conflict = await reserve({ requestId, amount: 12_000, fingerprint: "esim:v1:other:12000" });
    expect(conflict).toMatchObject({ kind: "conflict", status: "held" });
    expect(await account()).toEqual({ balance: 50_000, reserved: 9_800 });
  });

  it("refuses an amount that is not a positive whole number of naira", async () => {
    await expect(reserve({ amount: 0 })).rejects.toThrow(/positive whole-naira/);
    await expect(reserve({ amount: 12.5 })).rejects.toThrow(/positive whole-naira/);
    await expect(reserve({ amount: 10_000_000_000 })).rejects.toThrow(/positive whole-naira/);
  });

  it("refuses a suspended account", async () => {
    await database.update(schema.users).set({ suspendedAt: new Date() }).where(eq(schema.users.id, USER));
    expect(await reserve()).toEqual({ kind: "ineligible" });
    expect(await account()).toEqual({ balance: 50_000, reserved: 0 });
  });
});

describe("concurrent spend", () => {
  it("lets only one of two simultaneous orders spend the same money", async () => {
    // The exact race the old code had: both read ₦50,000, both believed they
    // could afford ₦30,000, both called the supplier. One wallet, one winner.
    await database.update(schema.users).set({ walletBalance: 50_000 }).where(eq(schema.users.id, USER));
    const [a, b] = await Promise.all([
      reserve({ requestId: randomUUID(), amount: 30_000 }),
      reserve({ requestId: randomUUID(), amount: 30_000 }),
    ]);
    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(["insufficient", "reserved"]);
    expect(await account()).toEqual({ balance: 50_000, reserved: 30_000 });
    expect(await reservations.availableBalance(USER)).toBe(20_000);
    expect(await holds()).toHaveLength(1);
  });

  it("reserves exactly what the wallet can hold when several requests arrive at once", async () => {
    await database.update(schema.users).set({ walletBalance: 25_000 }).where(eq(schema.users.id, USER));
    const results = await Promise.all(
      Array.from({ length: 5 }, () => reserve({ requestId: randomUUID(), amount: 9_800 })),
    );
    expect(results.filter((r) => r.kind === "reserved")).toHaveLength(2);
    expect(results.filter((r) => r.kind === "insufficient")).toHaveLength(3);
    const { balance, reserved } = await account();
    expect(reserved).toBe(19_600);
    expect(balance).toBe(25_000);
    expect(balance - reserved).toBe(5_400);
  });

  it("reserves once when the same request key arrives twice at once", async () => {
    const requestId = randomUUID();
    const results = await Promise.all([reserve({ requestId }), reserve({ requestId })]);
    expect(results.filter((r) => r.kind === "reserved")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "existing")).toHaveLength(1);
    expect(await account()).toEqual({ balance: 50_000, reserved: 9_800 });
    expect(await holds()).toHaveLength(1);
  });
});

describe("settling", () => {
  function settle(reservationId: string, amount = 9_800, orderId: string | null = null) {
    return database.transaction((tx) =>
      reservations.settleReservation({
        tx,
        reservationId,
        userId: USER,
        amount,
        description: "Nigeria Lite · 1GB of data · 7 days",
        orderId,
        reference: "PRY-TEST",
      }),
    );
  }

  it("turns a hold into the debit, with one ledger row", async () => {
    const { kind, reservationId } = (await reserve()) as { kind: string; reservationId: string };
    expect(kind).toBe("reserved");

    const settled = await settle(reservationId);
    expect(settled.reservationAlreadyClosed).toBe(false);
    expect(settled.balance).toBe(40_200);

    expect(await account()).toEqual({ balance: 40_200, reserved: 0 });
    const [hold] = await holds();
    expect(hold).toMatchObject({ status: "settled", amount: 9_800 });
    expect(hold.settledAt).toBeInstanceOf(Date);
    const entries = await database.select().from(schema.walletTransactions);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ userId: USER, type: "debit", amount: 9_800, balanceAfter: 40_200, reference: "PRY-TEST" });
  });

  it("settles once, whatever arrives afterwards", async () => {
    const { reservationId } = (await reserve()) as { reservationId: string };
    await settle(reservationId);
    const again = await settle(reservationId);
    expect(again.reservationAlreadyClosed).toBe(true);
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(1);
    expect(await account()).toEqual({ balance: 40_200, reserved: 0 });
  });

  it("cannot be settled for an amount other than the one it reserved", async () => {
    const { reservationId } = (await reserve()) as { reservationId: string };
    await expect(settle(reservationId, 12_000)).rejects.toThrow(/different amount/);
    expect(await account()).toEqual({ balance: 50_000, reserved: 9_800 });
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(0);
  });

  it("refuses to settle another account's hold", async () => {
    const { reservationId } = (await reserve()) as { reservationId: string };
    const other = randomUUID();
    await database.insert(schema.users).values({
      id: other, name: "Other", email: "other@example.com", passwordHash: "hash", walletBalance: 10_000,
    });
    const result = await database.transaction((tx) =>
      reservations.settleReservation({
        tx, reservationId, userId: other, amount: 9_800, description: "x", reference: "PRY-X",
      }),
    );
    expect(result.reservationAlreadyClosed).toBe(true);
    expect(await account()).toEqual({ balance: 50_000, reserved: 9_800 });
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(0);
  });
});

describe("releasing", () => {
  function release(reservationId: string) {
    return database.transaction((tx) =>
      reservations.releaseReservation({ tx, reservationId, userId: USER, reason: "supplier refused" }),
    );
  }

  it("gives the money back exactly once", async () => {
    const { reservationId } = (await reserve()) as { reservationId: string };
    const released = await release(reservationId);
    expect(released).toEqual({ released: true, balance: 50_000 });
    expect(await account()).toEqual({ balance: 50_000, reserved: 0 });
    const [hold] = await holds();
    expect(hold).toMatchObject({ status: "released" });
    expect(hold.releasedAt).toBeInstanceOf(Date);

    const again = await release(reservationId);
    expect(again.released).toBe(false);
    expect(await account()).toEqual({ balance: 50_000, reserved: 0 });
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(0);
  });

  it("cannot resurrect a settled hold", async () => {
    const { reservationId } = (await reserve()) as { reservationId: string };
    await database.transaction((tx) =>
      reservations.settleReservation({
        tx, reservationId, userId: USER, amount: 9_800, description: "x", reference: "PRY-Y",
      }),
    );
    expect((await release(reservationId)).released).toBe(false);
    expect(await account()).toEqual({ balance: 40_200, reserved: 0 });
  });
});

describe("an interrupted attempt", () => {
  it("leaves the money held, not spent and not returned, and says so", async () => {
    // A crash between reserve and settle looks exactly like this: the row exists
    // in `held`, the supplier may have been paid, and nobody may guess.
    const { reservationId } = (await reserve({ ttlMs: -1 })) as { reservationId: string };
    expect(await account()).toEqual({ balance: 50_000, reserved: 9_800 });
    expect(await reservations.availableBalance(USER)).toBe(40_200);

    const stale = await reservations.expiredHolds(10);
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ id: reservationId, status: "held", amount: 9_800, service: "esim" });

    // Reading never moves money: the report above is the whole of what expiry does.
    expect(await account()).toEqual({ balance: 50_000, reserved: 9_800 });
    expect(await holds()).toHaveLength(1);
  });

  it("reports open holds so a balance can be explained", async () => {
    await reserve({ requestId: randomUUID(), amount: 9_800 });
    const second = (await reserve({ requestId: randomUUID(), amount: 5_000 })) as { reservationId: string };
    await reservations.holdForReview({ reservationId: second.reservationId, userId: USER, note: "unknown" });
    expect(await reservations.openHolds(USER)).toEqual({ held: 9_800, review: 5_000, total: 14_800, holdCount: 2 });
  });
});

describe("review", () => {
  it("parks an ambiguous outcome so no path can settle or release it by accident", async () => {
    const { reservationId } = (await reserve()) as { reservationId: string };
    expect(await reservations.holdForReview({ reservationId, userId: USER, note: "unknown" })).toBe(true);
    const [hold] = await holds();
    expect(hold.status).toBe("review");

    // Both normal closings now refuse: the funds stay put until a human decides.
    const settleAttempt = await database.transaction((tx) =>
      reservations.settleReservation({ tx, reservationId, userId: USER, amount: 9_800, description: "x", reference: "PRY-Z" }),
    );
    expect(settleAttempt.reservationAlreadyClosed).toBe(true);
    const releaseAttempt = await database.transaction((tx) =>
      reservations.releaseReservation({ tx, reservationId, userId: USER, reason: "x" }),
    );
    expect(releaseAttempt.released).toBe(false);
    expect(await account()).toEqual({ balance: 50_000, reserved: 9_800 });
  });

  it("lets an operator settle it after confirming the supplier delivered", async () => {
    const { reservationId } = (await reserve()) as { reservationId: string };
    await reservations.holdForReview({ reservationId, userId: USER, note: "unknown" });

    const resolved = await reservations.resolveReviewedReservation({
      reservationId,
      action: "settle",
      description: "Confirmed delivered by the supplier console",
    });
    expect(resolved.changed).toBe(true);
    expect(await account()).toEqual({ balance: 40_200, reserved: 0 });
    expect((await holds())[0].status).toBe("settled");
    expect(await database.select().from(schema.walletTransactions)).toHaveLength(1);
  });

  it("lets an operator release it after confirming nothing was bought", async () => {
    const { reservationId } = (await reserve()) as { reservationId: string };
    await reservations.holdForReview({ reservationId, userId: USER, note: "unknown" });

    const resolved = await reservations.resolveReviewedReservation({
      reservationId,
      action: "release",
      description: "Supplier confirmed no order exists",
    });
    expect(resolved.changed).toBe(true);
    expect(await account()).toEqual({ balance: 50_000, reserved: 0 });
    expect((await holds())[0].status).toBe("released");
  });

  it("does nothing to a hold that is not in review", async () => {
    const { reservationId } = (await reserve()) as { reservationId: string };
    const resolved = await reservations.resolveReviewedReservation({
      reservationId,
      action: "release",
      description: "should not apply",
    });
    expect(resolved.changed).toBe(false);
    expect(await account()).toEqual({ balance: 50_000, reserved: 9_800 });
  });
});

describe("the ledger stays explainable", () => {
  it("keeps balance plus reserved equal to the money the account started with", async () => {
    const first = (await reserve({ amount: 4_000 })) as { reservationId: string };
    await reserve({ requestId: randomUUID(), amount: 5_000 });
    await database.transaction((tx) =>
      reservations.settleReservation({ tx, reservationId: first.reservationId, userId: USER, amount: 4_000, description: "x", reference: "PRY-A" }),
    );
    const { balance, reserved } = await account();
    // 50,000 − 4,000 settled = a 46,000 ledger balance, of which 5,000 is held.
    expect(balance).toBe(46_000);
    expect(reserved).toBe(5_000);
    expect(await reservations.availableBalance(USER)).toBe(41_000);
    // The debit is on the ledger with the balance it produced, so the nightly
    // close can still walk `previous ± amount = balance_after`.
    const [entry] = await database.select().from(schema.walletTransactions);
    expect(entry).toMatchObject({ amount: 4_000, balanceAfter: 46_000 });
  });
});
