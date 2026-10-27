import { describe, expect, it } from "vitest";

/**
 * The demo account is the only dashboard most visitors will ever see, so its
 * data has to hold together: a live code, a refund, and a wallet ledger whose
 * running balance actually lands on the balance we show.
 */
async function loadDb() {
  process.env.DATABASE_URL = "";
  const { db } = await import("@/db");
  const { orders, walletTransactions, notifications } = await import("@/db/schema");
  const drizzle = await import("drizzle-orm");
  return { db, orders, walletTransactions, notifications, drizzle };
}

describe("demo dashboard seed", () => {
  it("seeds the states a real customer passes through", async () => {
    const { db, orders, drizzle } = await loadDb();
    const rows = await db.select().from(orders).where(drizzle.eq(orders.userId, "demo-user"));

    expect(rows).toHaveLength(5);
    expect(rows.filter((row) => row.status === "active")).toHaveLength(4);
    expect(rows.filter((row) => row.status === "refunded")).toHaveLength(1);

    const liveCode = rows.find((row) => row.otpCode !== null);
    expect(liveCode?.otpCode).toBe("482069");
    expect(liveCode?.referenceCode).toBe("+234 812 445 9081");
    expect(new Date(liveCode!.expiresAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it("keeps the wallet ledger consistent to the last naira", async () => {
    const { db, walletTransactions, drizzle } = await loadDb();
    const rows = await db
      .select()
      .from(walletTransactions)
      .where(drizzle.eq(walletTransactions.userId, "demo-user"));
    const ordered = [...rows].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    let running = 0;
    for (const tx of ordered) {
      running += tx.type === "debit" ? -tx.amount : tx.amount;
      expect(tx.balanceAfter, `balance after ${tx.id}`).toBe(running);
    }
    expect(running).toBe(25000);
  });

  it("answers count() and sum() aggregates from the preview database", async () => {
    const { db, orders, drizzle } = await loadDb();

    const [total] = await db
      .select({ value: drizzle.count() })
      .from(orders)
      .where(drizzle.eq(orders.userId, "demo-user"));
    const [refunded] = await db
      .select({ value: drizzle.sum(orders.amount) })
      .from(orders)
      .where(drizzle.and(drizzle.eq(orders.userId, "demo-user"), drizzle.eq(orders.status, "refunded")));

    expect(Number(total?.value)).toBe(5);
    expect(Number(refunded?.value)).toBe(1670);
  });

  it("marks exactly one seeded notification unread", async () => {
    const { db, notifications, drizzle } = await loadDb();
    const rows = await db
      .select()
      .from(notifications)
      .where(drizzle.eq(notifications.userId, "demo-user"));

    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => !row.read)).toHaveLength(1);
  });
});
