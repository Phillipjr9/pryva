import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Frequency } from "@/lib/scheduled-orders";

/**
 * A scheduled run may not charge for something it did not buy.
 *
 * The old implementation debited the wallet and wrote an order marked
 * `delivered` with provider `scheduled`, without ever calling a supplier. These
 * tests pin the corrected order: fulfil first, then record and charge, and skip
 * the run entirely (leaving the money alone) when fulfilment is refused.
 */

const state = vi.hoisted(() => ({
  balance: 20000,
  schedule: null as any,
  insertRows: [] as any[],
  debits: [] as any[],
  updates: [] as any[],
  released: [] as any[],
  fulfilError: null as Error | null,
  fulfilable: new Set(["vn-ng", "rent-ng-30"]),
  txError: null as Error | null,
}));

vi.mock("@/db", async () => {
  const schema = await import("@/db/schema");
  const rowsFor = (table: unknown) =>
    table === schema.users ? [{ walletBalance: state.balance }] : state.schedule ? [state.schedule] : [];
  const chain = (rows: unknown[]) => {
    const api: Record<string, unknown> = {
      from: (table: unknown) => chain(rowsFor(table)),
      where: () => api,
      limit: () => Promise.resolve(rows),
      values: (value: unknown) => {
        state.insertRows.push(value);
        return Promise.resolve();
      },
      set: (value: unknown) => {
        state.updates.push(value);
        return { where: () => Promise.resolve() };
      },
    };
    return api;
  };
  const tx = {
    select: () => ({ from: (table: unknown) => chain(rowsFor(table)) }),
    insert: () => chain([]),
    update: () => chain([]),
  };
  return {
    db: {
      select: () => ({ from: (table: unknown) => chain(rowsFor(table)) }),
      insert: () => chain([]),
      update: () => chain([]),
      transaction: async (callback: (txArg: unknown) => Promise<unknown>) => {
        if (state.txError) throw state.txError;
        return callback(tx);
      },
    },
  };
});

vi.mock("@/lib/fulfillment", () => ({
  fulfilmentIntent: (slug: string) => (state.fulfilable.has(slug) ? { kind: "sms", country: "ng" } : null),
  fulfillPlan: async (plan: { slug: string; price: number }) => {
    if (state.fulfilError) throw state.fulfilError;
    return {
      provider: "fleexa",
      providerCostNgn: plan.price - 200,
      providerRequestId: `req-${plan.slug}`,
      referenceCode: "+2348012345678",
      otpCode: null,
      expiresAt: new Date(Date.now() + 600_000),
    };
  },
  cancelUpstream: async (order: unknown) => {
    state.released.push(order);
    return true;
  },
}));

vi.mock("@/lib/wallet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wallet")>();
  return {
    ...actual,
    debitWalletInTx: async (_tx: unknown, entry: unknown) => {
      state.debits.push(entry);
      state.balance -= (entry as { amount: number }).amount;
      return state.balance;
    },
  };
});

const { calculateNextRun, createScheduledOrder, processScheduledOrder } = await import("@/lib/scheduled-orders");

const USER_ID = "test-sched-user-1";
const SCHEDULE_ID = "sched-row-1";

function dueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SCHEDULE_ID,
    userId: USER_ID,
    service: "numbers",
    productSlug: "vn-ng",
    frequency: "daily" as Frequency,
    nextRunAt: new Date(Date.now() - 60_000),
    status: "active" as const,
    lastRunAt: null,
    lastOrderId: null,
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  state.balance = 20000;
  state.schedule = dueRow();
  state.insertRows = [];
  state.debits = [];
  state.updates = [];
  state.released = [];
  state.fulfilError = null;
  state.txError = null;
});

describe("Scheduled Orders", () => {
  describe("calculateNextRun", () => {
    it("calculates each frequency", () => {
      const now = new Date();
      const days = (frequency: Frequency) => (calculateNextRun(frequency).getTime() - now.getTime()) / 86_400_000;
      expect(days("daily")).toBeCloseTo(1, 0);
      expect(days("weekly")).toBeCloseTo(7, 0);
      expect(days("biweekly")).toBeCloseTo(14, 0);
    });

    it("handles monthly rollover and clamps month-end dates", () => {
      const december = new Date(2024, 11, 15);
      const next = calculateNextRun("monthly", december);
      expect(next.getFullYear()).toBe(2025);
      expect(next.getMonth()).toBe(0);

      const monthEnd = calculateNextRun("monthly", new Date(2024, 0, 31));
      expect(monthEnd.getMonth()).toBe(1);
      expect(monthEnd.getDate()).toBe(29);
    });

    it("rejects an unknown frequency rather than scheduling immediately", () => {
      expect(() => calculateNextRun("invalid" as Frequency)).toThrow("Invalid frequency");
    });
  });

  describe("createScheduledOrder", () => {
    it("refuses a plan with no supplier path", async () => {
      await expect(
        createScheduledOrder({ userId: USER_ID, service: "proxies", productSlug: "proxy-ng-1", frequency: "weekly" }),
      ).rejects.toThrow(/cannot be delivered automatically/);
    });
  });

  describe("processScheduledOrder", () => {
    it("charges nothing and records nothing when fulfilment is unavailable", async () => {
      state.fulfilError = new Error("provider is down");

      const result = await processScheduledOrder(dueRow() as any);

      expect(result).toBe(false);
      expect(state.balance).toBe(20000);
      expect(state.debits).toHaveLength(0);
      expect(state.insertRows).toHaveLength(0);
      // The row stays active, so the next run can try again.
      expect(state.updates).toHaveLength(0);
    });

    it("records the supplier's own identifiers and charges only after a successful buy", async () => {
      const result = await processScheduledOrder(dueRow() as any);

      expect(result).toBe(true);
      expect(state.insertRows).toHaveLength(1);
      const order = state.insertRows[0];
      expect(order.provider).toBe("fleexa");
      expect(order.providerRequestId).toBe("req-vn-ng");
      expect(order.referenceCode).toBe("+2348012345678");
      expect(order.status).toBe("active");
      expect(state.debits).toHaveLength(1);
      expect(state.updates[0]).toMatchObject({ lastOrderId: order.id });
    });

    it("skips a run that is not yet due and buys nothing", async () => {
      state.schedule = dueRow({ nextRunAt: new Date(Date.now() + 86_400_000) });

      expect(await processScheduledOrder(dueRow({ nextRunAt: new Date(Date.now() + 86_400_000) }) as any)).toBe(false);
      expect(state.debits).toHaveLength(0);
      expect(state.insertRows).toHaveLength(0);
    });

    it("skips a paused schedule", async () => {
      state.schedule = null;
      expect(await processScheduledOrder(dueRow({ status: "paused" as const }) as any)).toBe(false);
      expect(state.debits).toHaveLength(0);
    });

    it("skips a plan that has no supplier path without charging", async () => {
      state.schedule = dueRow({ service: "proxies", productSlug: "proxy-ng-1" });
      expect(await processScheduledOrder(state.schedule as any)).toBe(false);
      expect(state.debits).toHaveLength(0);
      expect(state.insertRows).toHaveLength(0);
    });

    it("releases the purchase when recording it fails", async () => {
      state.txError = new Error("database went away");

      await expect(processScheduledOrder(dueRow() as any)).rejects.toThrow("database went away");
      expect(state.released).toHaveLength(1);
      expect(state.debits).toHaveLength(0);
      expect(state.insertRows).toHaveLength(0);
    });
  });
});
