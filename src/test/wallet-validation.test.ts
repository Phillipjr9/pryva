import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

let database: typeof import("@/db");
let schema: typeof import("@/db/schema");
let wallet: typeof import("@/lib/wallet");

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  [database, schema, wallet] = await Promise.all([import("@/db"), import("@/db/schema"), import("@/lib/wallet")]);
});

async function createUser(balance: number) {
  const id = randomUUID();
  await database.db.insert(schema.users).values({ id, name: "Wallet Tester", email: `${id}@example.test`, passwordHash: "hash", walletBalance: balance });
  return id;
}

describe("wallet entry validation", () => {
  it("rejects invalid amounts and contradictory types before modifying a wallet", async () => {
    const userId = await createUser(1000);
    for (const amount of [-1, 0, 0.5, NaN, Infinity, 2_147_483_648]) {
      await expect(wallet.creditWallet({ userId, amount, type: "credit", description: "test" })).rejects.toThrow();
      await expect(wallet.debitWallet({ userId, amount, type: "debit", description: "test" })).rejects.toThrow();
    }
    await expect(wallet.creditWallet({ userId, amount: 10, type: "debit", description: "test" })).rejects.toThrow();
    await expect(wallet.debitWallet({ userId, amount: 10, type: "refund", description: "test" })).rejects.toThrow();
    expect((await database.db.query.users.findFirst({ where: eq(schema.users.id, userId) }))?.walletBalance).toBe(1000);
    expect(await database.db.query.walletTransactions.findMany({ where: eq(schema.walletTransactions.userId, userId) })).toHaveLength(0);
  });

  it("rejects credits that would overflow a PostgreSQL integer balance", async () => {
    const userId = await createUser(2_147_483_637);
    await expect(wallet.creditWallet({ userId, amount: 11, type: "credit", description: "test" })).rejects.toThrow();
    expect((await database.db.query.users.findFirst({ where: eq(schema.users.id, userId) }))?.walletBalance).toBe(2_147_483_637);
    expect(await database.db.query.walletTransactions.findMany({ where: eq(schema.walletTransactions.userId, userId) })).toHaveLength(0);
    expect(await wallet.creditWallet({ userId, amount: 10, type: "credit", description: "test" })).toBe(2_147_483_647);
  });
});
