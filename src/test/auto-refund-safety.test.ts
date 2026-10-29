import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { RECONCILIATION_NOTE, SINGLE_NUMBER_WINDOW } from "@/lib/refund-policy";

const mocks = vi.hoisted(() => ({ cancelUpstream: vi.fn() }));
vi.mock("@/lib/fulfillment", () => ({ cancelUpstream: mocks.cancelUpstream }));

// Exercise the real in-memory adapter as well as the refund policy: its
// SQL-condition emulation must not ignore IS NULL checks.
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
beforeEach(() => {
  mocks.cancelUpstream.mockReset();
  // cancelUpstream reports whether a real upstream release happened.
  mocks.cancelUpstream.mockResolvedValue(true);
});
afterAll(() => vi.unstubAllEnvs());

const old = () => new Date(Date.now() - 60 * 60_000);

async function insertUndelivered(overrides: Record<string, unknown> = {}) {
  await db.insert(schema.orders).values({
    id: "refund-eligible", reference: "REFUND-TEST", userId: "demo-user", service: "numbers",
    productSlug: "vn-ng", productName: "Test number", planLabel: "Single", region: "Nigeria",
    duration: SINGLE_NUMBER_WINDOW, amount: 1000, status: "active", provider: "fleexa",
    providerRequestId: "req-123", createdAt: old(), refundedAt: null, otpCode: null,
    ...overrides,
  } as never);
}

describe("automatic refunds for undelivered number orders", () => {
  it("refunds an expired live single number with no code, once, and releases it upstream", async () => {
    // The seeded number already has a code; age it to expose any bug that
    // ignores the code. Rentals and eSIMs in the seed are already old.
    await db.update(schema.orders).set({ createdAt: old() }).where(eq(schema.orders.id, "demo-order-live"));
    await insertUndelivered();

    const [before] = await db.select().from(schema.users).where(eq(schema.users.id, "demo-user"));
    expect(await processAutoRefunds()).toEqual({ refunded: 1, cancelled: 1 });
    // Idempotent: a second sweep must not credit the same order again.
    expect(await processAutoRefunds()).toEqual({ refunded: 0, cancelled: 0 });

    const all = await db.select().from(schema.orders).where(eq(schema.orders.userId, "demo-user"));
    expect(all.find((order) => order.id === "refund-eligible")?.status).toBe("refunded");
    // Released cleanly, so there is nothing for a human to chase.
    expect(all.find((order) => order.id === "refund-eligible")?.reconciliationNote).toBeFalsy();
    expect(all.find((order) => order.id === "demo-order-live")?.status).toBe("active");
    // A rental has no upstream cancel, so it must never be swept automatically.
    expect(all.find((order) => order.id === "demo-order-rental")?.status).toBe("active");
    expect(all.find((order) => order.id === "demo-order-esim")?.status).toBe("active");

    const [after] = await db.select().from(schema.users).where(eq(schema.users.id, "demo-user"));
    expect(after.walletBalance).toBe(before.walletBalance + 1000);

    const ledger = await db.select().from(schema.walletTransactions).where(eq(schema.walletTransactions.orderId, "refund-eligible"));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ type: "refund", amount: 1000, balanceAfter: after.walletBalance });

    expect(mocks.cancelUpstream).toHaveBeenCalledTimes(1);
    expect(mocks.cancelUpstream.mock.calls[0][0]).toMatchObject({
      provider: "fleexa", providerRequestId: "req-123",
    });
  });

  it("still refunds when the upstream cancel fails — our cost recovery never withholds the customer's money", async () => {
    mocks.cancelUpstream.mockRejectedValue(new Error("provider 502"));
    await insertUndelivered({ id: "cancel-fails", reference: "REFUND-CANCEL-FAILS" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await processAutoRefunds()).toEqual({ refunded: 1, cancelled: 0 });

    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, "cancel-fails"));
    expect(order.status).toBe("refunded");
    expect(error).toHaveBeenCalled();
    // The exposure has to reach a human: the money is back with the customer and
    // the number may still be working in their hands. A log line is not enough,
    // because nothing reads it.
    expect(order.reconciliationNote).toBe(RECONCILIATION_NOTE);
    error.mockRestore();
  });

  it("keeps supplier names and costs out of the note an admin reads", () => {
    expect(RECONCILIATION_NOTE.toLowerCase())
      .not.toMatch(/fleexa|bulkacc|accszone|freshbulkacc|reseller|wholesale|supplier|upstream/);
    expect(RECONCILIATION_NOTE).not.toMatch(/[0-9₦$]/);
  });

  it("runs against a real database, not only the in-memory preview", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://configured");
    const response = await cronPost(new NextRequest("https://pryva.test/api/cron/auto-refund", {
      method: "POST", headers: { authorization: "Bearer test-cron-secret" },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    vi.stubEnv("DATABASE_URL", "");
  });

  it("still rejects a cron call without the shared secret", async () => {
    const response = await cronPost(new NextRequest("https://pryva.test/api/cron/auto-refund", {
      method: "POST", headers: { authorization: "Bearer wrong" },
    }));
    expect(response.status).toBe(401);
  });
});
