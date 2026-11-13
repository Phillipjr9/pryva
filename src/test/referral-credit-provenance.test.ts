import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";

const mocks = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/email/schedule-wallet-emails", () => ({ scheduleWalletEmails: vi.fn() }));
let pg: PGlite;
let db: PgliteDatabase<typeof schema>;
let wallet: typeof import("@/lib/payments/wallet");
let gifts: typeof import("@/lib/services/gift-cards/credit");
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

async function migrations(target: PGlite, last = "0047") {
  for (const file of (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name) && name.slice(0, 4) <= last).sort()) await target.exec(await readFile(`migrations/${file}`, "utf8"));
}
beforeAll(async () => {
  pg = new PGlite(); await migrations(pg); db = drizzle(pg, { schema }); mocks.db = db;
  wallet = await import("@/lib/payments/wallet"); gifts = await import("@/lib/services/gift-cards/credit");
}, 60000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE users CASCADE`);
  await db.insert(schema.users).values([
    { id: A, name: "A", email: "a@example.test", passwordHash: "x", walletBalance: 2000 },
    { id: B, name: "B", email: "b@example.test", passwordHash: "x", walletBalance: 0 },
    { id: C, name: "C", email: "c@example.test", passwordHash: "x", walletBalance: 0 },
  ]);
});
async function balances(id: string) {
  const result = await pg.query<{ wallet_balance: number; referral_credit_balance: number; wallet_provenance_known: boolean }>("SELECT wallet_balance, referral_credit_balance, wallet_provenance_known FROM users WHERE id = $1", [id]);
  return result.rows[0];
}
async function referral(amount: number) {
  const reference = "REFL-TEST";
  await db.insert(schema.referrals).values({ referrerId: A, refereeId: B, code: "TEST", status: "credited", rewardAmount: amount, rewardReference: reference });
  await db.transaction((tx) => wallet.creditWalletInTx(tx, { userId: A, type: "credit", amount, description: "Reward", reference }));
}
async function buy(amount: number) {
  const [order] = await db.insert(schema.orders).values({ reference: wallet.makeReference("TST"), userId: A, service: "numbers", productSlug: "vn-ng", productName: "Number", planLabel: "Single", region: "NG", duration: "Single", amount, status: "active", provider: "bitcall" }).returning();
  await db.transaction((tx) => wallet.debitWalletInTx(tx, { userId: A, type: "debit", amount, description: "Order", orderId: order.id }));
  return order;
}
async function withdraw(userId: string, amount: number) {
  await db.transaction(async (tx) => {
    const [updated] = await tx.update(schema.users).set({ walletBalance: sql`${schema.users.walletBalance} - ${amount}` }).where(eq(schema.users.id, userId)).returning({ balance: schema.users.walletBalance });
    await tx.insert(schema.walletTransactions).values({ userId, type: "withdrawal", amount, balanceAfter: updated.balance, description: "Withdrawal", reference: crypto.randomUUID() });
  });
}

describe("nonwithdrawable referral credit", () => {
  it("spends referral credit first, restores it on refund and lets only the cash portion leave", async () => {
    await referral(1200);
    expect(await balances(A)).toMatchObject({ wallet_balance: 3200, referral_credit_balance: 1200, wallet_provenance_known: true });
    await expect(withdraw(A, 2001)).rejects.toThrow();
    expect((await balances(A)).wallet_balance).toBe(3200);
    const order = await buy(1500);
    expect(await balances(A)).toMatchObject({ wallet_balance: 1700, referral_credit_balance: 0 });
    await db.transaction((tx) => wallet.creditWalletInTx(tx, { userId: A, type: "refund", amount: 1500, description: "Refund", orderId: order.id }));
    expect(await balances(A)).toMatchObject({ wallet_balance: 3200, referral_credit_balance: 1200 });
    await withdraw(A, 2000);
    expect(await balances(A)).toMatchObject({ wallet_balance: 1200, referral_credit_balance: 1200 });
    await expect(withdraw(A, 1)).rejects.toThrow();
  });

  it("restores restricted credit first across partial refunds without exceeding the original restricted debit", async () => {
    await referral(1200);
    const order = await buy(1500);
    await db.transaction((tx) => wallet.creditWalletInTx(tx, { userId: A, type: "refund", amount: 700, description: "Partial refund", orderId: order.id }));
    expect(await balances(A)).toMatchObject({ wallet_balance: 2400, referral_credit_balance: 700 });
    await db.transaction((tx) => wallet.creditWalletInTx(tx, { userId: A, type: "refund", amount: 800, description: "Final refund", orderId: order.id }));
    expect(await balances(A)).toMatchObject({ wallet_balance: 3200, referral_credit_balance: 1200 });
  });

  it("does not let competing withdrawals consume restricted funds", async () => {
    await referral(1200);
    const results = await Promise.allSettled([withdraw(A, 1500), withdraw(A, 1500)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await balances(A)).toMatchObject({ wallet_balance: 1700, referral_credit_balance: 1200 });
  });

  it("carries the restricted share across a wallet gift card", async () => {
    await referral(1200);
    const card = await gifts.createGiftCard({ userId: A, amount: 1500, requestId: crypto.randomUUID() });
    expect(await balances(A)).toMatchObject({ wallet_balance: 1700, referral_credit_balance: 0 });
    await gifts.redeemGiftCard({ userId: C, code: card.code });
    expect(await balances(C)).toMatchObject({ wallet_balance: 1500, referral_credit_balance: 1200, wallet_provenance_known: true });
    await expect(withdraw(C, 301)).rejects.toThrow();
    await withdraw(C, 300);
    expect(await balances(C)).toMatchObject({ wallet_balance: 1200, referral_credit_balance: 1200 });
  });

  it("holds an unlinked refund for review rather than turning unknown funds into cash", async () => {
    await referral(1200);
    await buy(1200);
    const [unlinked] = await db.insert(schema.orders).values({ reference: "legacy-bulk", userId: A, service: "numbers", productSlug: "vn-ng", productName: "Number", planLabel: "Single", region: "NG", duration: "Single", amount: 1000, status: "active", provider: "bitcall" }).returning();
    await db.transaction((tx) => wallet.creditWalletInTx(tx, { userId: A, type: "refund", amount: 1000, description: "Old bulk refund", orderId: unlinked.id }));
    expect((await balances(A)).wallet_provenance_known).toBe(false);
    await expect(withdraw(A, 1)).rejects.toThrow();
  });

  it("rejects debiting away restricted funds without a matching ledger entry", async () => {
    await referral(1200);
    await expect(db.transaction(async (tx) => {
      await tx.update(schema.users).set({ walletBalance: 0 }).where(eq(schema.users.id, A));
    })).rejects.toThrow();
    expect(await balances(A)).toMatchObject({ wallet_balance: 3200, referral_credit_balance: 1200 });
  });

  it("rejects new wallet debits after suspension while still permitting refunds", async () => {
    await db.update(schema.users).set({ suspendedAt: new Date() }).where(eq(schema.users.id, A));
    await expect(db.transaction((tx) => wallet.debitWalletInTx(tx, { userId: A, type: "debit", amount: 1000, description: "Purchase" }))).rejects.toThrow("not eligible");
    await expect(gifts.createGiftCard({ userId: A, amount: 1000, requestId: crypto.randomUUID() })).rejects.toThrow();
    await db.transaction((tx) => wallet.creditWalletInTx(tx, { userId: A, type: "refund", amount: 100, description: "Refund", reference: "RWD-suspension-test" }));
    expect((await balances(A)).wallet_balance).toBe(2100);
  });

  it("never accepts a forged referral reference as ordinary cash", async () => {
    await expect(db.transaction((tx) => wallet.creditWalletInTx(tx, { userId: A, amount: 100, type: "credit", description: "Invalid", reference: "REFL-FAKE" }))).rejects.toThrow();
    expect((await balances(A)).wallet_balance).toBe(2000);
  });
});

describe("historic source reconciliation", () => {
  it("marks referrers, gift recipients and chained recipients unknown without reducing balances", async () => {
    const older = new PGlite();
    try {
      await migrations(older, "0037");
      await older.query(`INSERT INTO users (id,name,email,password_hash,wallet_balance) VALUES ($1,'A','old-a@example.test','x',5000),($2,'B','old-b@example.test','x',3000),($3,'C','old-c@example.test','x',1000)`, [A, B, C]);
      await older.query(`INSERT INTO referrals (referrer_id,referee_id,code,status,reward_amount,reward_reference) VALUES ($1,$2,'TEST','credited',1000,'REFL-HIST')`, [A, B]);
      await older.query(`INSERT INTO gift_cards (code, amount, initial_amount, purchased_by, redeemed_by, status, expires_at) VALUES ('PRYVA-AAAA-BBBB-CCCC',1000,1000,$1,$2,'redeemed',now()+interval '1 day'),('PRYVA-DDDD-EEEE-FFFF',1000,1000,$2,$3,'redeemed',now()+interval '1 day')`, [A, B, C]);
      await older.exec(await readFile("migrations/0038_referral_credit_provenance.sql", "utf8"));
      const rows = await older.query<{ wallet_balance: number; wallet_provenance_known: boolean }>("SELECT wallet_balance,wallet_provenance_known FROM users ORDER BY wallet_balance DESC");
      expect(rows.rows).toEqual([{ wallet_balance: 5000, wallet_provenance_known: false }, { wallet_balance: 3000, wallet_provenance_known: false }, { wallet_balance: 1000, wallet_provenance_known: false }]);
    } finally { await older.close(); }
  }, 60000);
});
