import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { PREVIEW_SINGLE_NUMBER_WINDOW } from "@/lib/refund-policy";

// Exercise the actual in-memory preview adapter as well as the refund policy:
// its SQL-condition emulation must not ignore IS NULL checks.
let db: typeof import("@/db").db;
let schema: typeof import("@/db/schema");
let processAutoRefunds: typeof import("@/lib/auto-refund").processAutoRefunds;
let cronPost: typeof import("@/app/api/cron/auto-refund/route").POST;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("CRON_SECRET", "test-cron-secret");
  ({ db } = await import("@/db"));
  schema = await import("@/db/schema");
  ({ processAutoRefunds } = await import("@/lib/auto-refund"));
  ({ POST: cronPost } = await import("@/app/api/cron/auto-refund/route"));
});
afterAll(() => vi.unstubAllEnvs());

describe("preview automatic refund policy", () => {
  it("refunds only an expired simulated single number without a code, once", async () => {
    const old = new Date(Date.now() - 60 * 60_000);
    // The seeded number already has a code; make it old enough to expose any
    // bug which ignores the code, while rentals and eSIMs are already old.
    await db.update(schema.orders).set({ createdAt: old }).where(eq(schema.orders.id, "demo-order-live"));
    await db.insert(schema.orders).values({
      id: "refund-eligible", reference: "REFUND-TEST", userId: "demo-user", service: "numbers",
      productSlug: "vn-ng", productName: "Test number", planLabel: "Single", region: "Nigeria",
      duration: PREVIEW_SINGLE_NUMBER_WINDOW, amount: 1000, status: "active", provider: "simulated",
      createdAt: old, refundedAt: null, otpCode: null,
    });
    const [before] = await db.select().from(schema.users).where(eq(schema.users.id, "demo-user"));
    expect(await processAutoRefunds()).toBe(1);
    expect(await processAutoRefunds()).toBe(0);
    const all = await db.select().from(schema.orders).where(eq(schema.orders.userId, "demo-user"));
    expect(all.find((order) => order.id === "refund-eligible")?.status).toBe("refunded");
    expect(all.find((order) => order.id === "demo-order-live")?.status).toBe("active");
    expect(all.find((order) => order.id === "demo-order-rental")?.status).toBe("active");
    expect(all.find((order) => order.id === "demo-order-esim")?.status).toBe("active");
    const [after] = await db.select().from(schema.users).where(eq(schema.users.id, "demo-user"));
    expect(after.walletBalance).toBe(before.walletBalance + 1000);
    const ledger = await db.select().from(schema.walletTransactions).where(eq(schema.walletTransactions.orderId, "refund-eligible"));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ type: "refund", amount: 1000, balanceAfter: after.walletBalance });
  });

  it("refuses the live cron and library sweep even with a valid cron secret", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://configured");
    await expect(processAutoRefunds()).rejects.toThrow("provider reconciliation");
    const response = await cronPost(new NextRequest("https://pryva.test/api/cron/auto-refund", {
      method: "POST", headers: { authorization: "Bearer test-cron-secret" },
    }));
    expect(response.status).toBe(503);
  });
});
