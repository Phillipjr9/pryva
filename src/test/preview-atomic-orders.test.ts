import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuthApi: mocks.user }));
vi.mock("@/lib/rate-limit", () => ({
  purchaseRateLimiter: async () => ({ allowed: true, resetTime: Date.now() + 1000 }),
  createRateLimiter: () => async () => ({ allowed: true, resetTime: Date.now() + 1000 }),
}));

let database: typeof import("@/db");
let schema: typeof import("@/db/schema");
let bulk: typeof import("@/app/api/orders/bulk/route");
let scheduled: typeof import("@/lib/scheduled-orders");
let plan: NonNullable<ReturnType<typeof import("@/lib/catalog").findPlan>>;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  [database, schema, bulk, scheduled] = await Promise.all([
    import("@/db"), import("@/db/schema"), import("@/app/api/orders/bulk/route"), import("@/lib/scheduled-orders"),
  ]);
  plan = (await import("@/lib/catalog")).findPlan("vn-ng")!;
});

async function createUser(balance: number) {
  const id = randomUUID();
  await database.db.insert(schema.users).values({ id, name: "Preview Tester", email: `${id}@example.test`, passwordHash: "hash", walletBalance: balance });
  return id;
}

async function createDueSchedule(userId: string) {
  const [order] = await database.db.insert(schema.scheduledOrders).values({
    id: randomUUID(), userId, service: plan.service, productSlug: plan.slug,
    frequency: "daily", nextRunAt: new Date(Date.now() - 60_000), status: "active",
  }).returning();
  return order;
}

function bulkRequest(items: unknown) {
  return new NextRequest("https://pryva.test/api/orders/bulk", {
    method: "POST", headers: { host: "pryva.test", "x-forwarded-proto": "https", origin: "https://pryva.test", "content-type": "application/json" },
    body: JSON.stringify({ items }),
  });
}

describe("atomic simulated order operations", () => {
  it("discards all draft changes when a synchronous preview mutation fails", async () => {
    const userId = await createUser(5000);
    expect(() => database.mutatePreviewDatabase((draft) => {
      draft.users.find((row) => row.id === userId)!.walletBalance = 0;
      draft.orders.push({ id: "partial-preview-order", userId });
      throw new Error("injected failure");
    })).toThrow("injected failure");
    const account = await database.db.query.users.findFirst({ where: eq(schema.users.id, userId) });
    expect(account?.walletBalance).toBe(5000);
    expect(await database.db.query.orders.findMany({ where: eq(schema.orders.userId, userId) })).toHaveLength(0);
  });

  it("commits the basket debit and simulated orders together with discounts allocated exactly", async () => {
    const userId = await createUser(50000);
    mocks.user.mockResolvedValue({ id: userId });
    const response = await bulk.POST(bulkRequest([{ productSlug: "vn-ng", quantity: 5 }, { productSlug: "vn-us", quantity: 5 }]));
    expect(response.status).toBe(200);
    const result = await response.json();
    const rows = await database.db.query.orders.findMany({ where: eq(schema.orders.userId, userId) });
    const ledger = await database.db.query.walletTransactions.findMany({ where: eq(schema.walletTransactions.userId, userId) });
    const account = await database.db.query.users.findFirst({ where: eq(schema.users.id, userId) });
    expect(rows).toHaveLength(10);
    expect(rows.reduce((total, row) => total + row.amount, 0)).toBe(result.total);
    expect(rows.find((row) => row.productSlug === "vn-us")?.region).not.toBe("Nigeria");
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ type: "debit", amount: result.total, balanceAfter: 50000 - result.total });
    expect(account?.walletBalance).toBe(50000 - result.total);
  });

  it("does not leave simulated orders or ledger entries for an unaffordable basket", async () => {
    const userId = await createUser(10);
    mocks.user.mockResolvedValue({ id: userId });
    expect((await bulk.POST(bulkRequest([{ productSlug: "vn-ng", quantity: 1 }]))).status).toBe(402);
    expect(await database.db.query.orders.findMany({ where: eq(schema.orders.userId, userId) })).toHaveLength(0);
    expect(await database.db.query.walletTransactions.findMany({ where: eq(schema.walletTransactions.userId, userId) })).toHaveLength(0);
  });

  it("processes a due schedule only once when two workers observe it", async () => {
    const userId = await createUser(10000);
    const due = await createDueSchedule(userId);
    expect(await Promise.all([scheduled.processScheduledOrder(due), scheduled.processScheduledOrder(due)])).toEqual([true, false]);
    const account = await database.db.query.users.findFirst({ where: eq(schema.users.id, userId) });
    expect(account?.walletBalance).toBe(10000 - plan.price);
    expect(await database.db.query.orders.findMany({ where: eq(schema.orders.userId, userId) })).toHaveLength(1);
    expect(await database.db.query.walletTransactions.findMany({ where: eq(schema.walletTransactions.userId, userId) })).toHaveLength(1);
  });

  it("uses the current balance for different simultaneous schedules and cannot reactivate a cancelled schedule", async () => {
    const userId = await createUser(plan.price);
    const first = await createDueSchedule(userId);
    const second = await createDueSchedule(userId);
    expect(await Promise.all([scheduled.processScheduledOrder(first), scheduled.processScheduledOrder(second)])).toEqual([true, false]);
    expect((await database.db.query.users.findFirst({ where: eq(schema.users.id, userId) }))?.walletBalance).toBe(0);
    expect(await scheduled.cancelScheduledOrder(second.id, userId)).toBe(true);
    expect(await scheduled.pauseScheduledOrder(second.id, userId)).toBe(false);
    expect(await scheduled.resumeScheduledOrder(second.id, userId)).toBe(false);
  });
});
