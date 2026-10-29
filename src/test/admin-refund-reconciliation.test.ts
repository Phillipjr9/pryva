import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { orders } from "@/db/schema";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  flagReconciliation: vi.fn(),
  scheduleWalletEmails: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  authorizeAdminApi: vi.fn(async () => ({ user: { id: "admin-1" }, response: null })),
}));
vi.mock("@/db", () => ({ db: { select: vi.fn(), transaction: mocks.transaction } }));
vi.mock("@/lib/reconciliation", () => ({ flagReconciliation: mocks.flagReconciliation }));
vi.mock("@/lib/schedule-wallet-emails", () => ({ scheduleWalletEmails: mocks.scheduleWalletEmails }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

const { POST } = await import("@/app/api/admin/refunds/route");

const ORDER_ID = "2f1c9a4e-0000-4000-8000-000000000001";

/**
 * The claim predicate inside the UPDATE is real SQL, and this fake transaction
 * returns the order regardless of it -- so these assertions cover the route's own
 * reconciliation branch, not the eligibility rules, which the database-backed
 * refund suites exercise.
 */
function fakeTransaction(claimed: boolean) {
  const order = { id: ORDER_ID, userId: "user-1", reference: "PV-1", amount: 1200, status: "review" };
  const tx = {
    update(table: unknown) {
      return {
        set() {
          return {
            where() {
              return {
                returning: async () =>
                  !claimed ? [] : table === orders ? [order] : [{ balance: 5000 }],
              };
            },
          };
        },
      };
    },
    insert() {
      return { values: async () => undefined };
    },
  };
  mocks.transaction.mockImplementation(async (callback: (t: typeof tx) => Promise<unknown>) => callback(tx));
}

function request(body: Record<string, unknown>) {
  return new NextRequest("https://pryva.test/api/admin/refunds", {
    method: "POST",
    headers: {
      host: "pryva.test",
      "x-forwarded-proto": "https",
      origin: "https://pryva.test",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.flagReconciliation.mockResolvedValue(undefined);
});

describe("admin refund reconciliation", () => {
  it("flags a refund that was confirmed past review, because the unit is never released", async () => {
    fakeTransaction(true);

    const response = await POST(request({
      orderId: ORDER_ID,
      reason: "Customer charged, provider never delivered",
      reconciliationConfirmed: true,
    }));

    expect(response.status).toBe(200);
    // This path credits the wallet without calling cancelUpstream, so the
    // exposure has to be recorded or the only trace is a log line.
    expect(mocks.flagReconciliation).toHaveBeenCalledTimes(1);
    expect(mocks.flagReconciliation).toHaveBeenCalledWith(ORDER_ID);
    expect(mocks.scheduleWalletEmails).toHaveBeenCalled();
  });

  it("does not flag an ordinary refund, so flagged rows stay exactly those needing a human", async () => {
    fakeTransaction(true);

    const response = await POST(request({ orderId: ORDER_ID }));

    expect(response.status).toBe(200);
    expect(mocks.flagReconciliation).not.toHaveBeenCalled();
  });

  it("does not flag a refund that never claimed an order", async () => {
    fakeTransaction(false);

    const response = await POST(request({
      orderId: ORDER_ID,
      reason: "whatever",
      reconciliationConfirmed: true,
    }));

    // Already refunded, still processing, or not found: nothing was credited, so
    // there is no exposure to record.
    expect(response.status).toBe(409);
    expect(mocks.flagReconciliation).not.toHaveBeenCalled();
    expect(mocks.scheduleWalletEmails).not.toHaveBeenCalled();
  });
});
