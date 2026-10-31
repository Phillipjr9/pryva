import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The nightly boost sweep.
 *
 * Reading an order back only when its owner opens the page means the customers
 * who never look never find out: a boost the panel cancelled would read
 * `active` indefinitely and never reach a human. The sweep fixes that, and these
 * tests pin what it may and may not do — it re-reads, it never retries `add`, and
 * a panel that cannot be reached changes nothing.
 */

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  selectThrows: false,
  writes: [] as Record<string, unknown>[],
  limits: [] as number[],
}));

function selectChain() {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "where", "orderBy"]) chain[method] = () => chain;
  chain.limit = (value: number) => {
    state.limits.push(value);
    if (state.selectThrows) return Promise.reject(new Error("database unreachable"));
    return Promise.resolve(state.rows);
  };
  return chain;
}

vi.mock("@/db", () => ({
  db: {
    select: () => selectChain(),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        state.writes.push(values);
        return { where: () => Promise.resolve() };
      },
    }),
  },
}));

vi.mock("@/lib/smm-panel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/smm-panel")>();
  return {
    ...actual,
    isSmmPanelConfigured: vi.fn(() => true),
    getSmmOrderStatus: vi.fn(),
    addSmmOrder: vi.fn(),
  };
});

import { addSmmOrder, getSmmOrderStatus, isSmmPanelConfigured, type SmmOrderStatus } from "@/lib/smm-panel";
import { clearBoostStatusCache, sweepBoostDeliveries } from "@/lib/boost-status";

function openOrder(id: string, status = "active") {
  return {
    id,
    provider: "smm",
    providerRequestId: `panel-${id}`,
    status,
    reconciliationNote: null,
  };
}

function report(status: SmmOrderStatus["status"], remains = 0): SmmOrderStatus {
  return {
    orderId: "panel-x",
    status,
    remains,
    startCount: 0,
    charge: 0.5,
    currency: "USD",
  };
}

beforeEach(() => {
  state.rows = [];
  state.selectThrows = false;
  state.writes = [];
  state.limits = [];
  clearBoostStatusCache();
  vi.mocked(isSmmPanelConfigured).mockReturnValue(true);
  vi.mocked(getSmmOrderStatus).mockReset();
});

afterEach(() => {
  clearBoostStatusCache();
});

describe("the nightly boost sweep", () => {
  it("does nothing at all when there is no panel to ask", async () => {
    vi.mocked(isSmmPanelConfigured).mockReturnValue(false);
    const result = await sweepBoostDeliveries();
    expect(result.skipped).toBe("panel not configured");
    expect(result.checked).toBe(0);
    expect(getSmmOrderStatus).not.toHaveBeenCalled();
  });

  it("closes a boost the panel finished as delivered", async () => {
    state.rows = [openOrder("a")];
    vi.mocked(getSmmOrderStatus).mockResolvedValue(report("completed"));
    const result = await sweepBoostDeliveries();
    expect(result).toMatchObject({ checked: 1, changed: 1, delivered: 1, review: 0 });
    expect(state.writes[0]).toEqual({ status: "delivered" });
  });

  it("flags a cancelled boost for a human instead of leaving it looking delivered", async () => {
    state.rows = [openOrder("a")];
    vi.mocked(getSmmOrderStatus).mockResolvedValue(report("canceled"));
    const result = await sweepBoostDeliveries();
    expect(result.review).toBe(1);
    expect(state.writes[0].status).toBe("review");
    expect(String(state.writes[0].reconciliationNote)).toMatch(/no automatic refund/i);
  });

  it("leaves a running order alone, because in-flight is not a failure", async () => {
    state.rows = [openOrder("a")];
    vi.mocked(getSmmOrderStatus).mockResolvedValue(report("in_progress", 400));
    const result = await sweepBoostDeliveries();
    expect(result).toMatchObject({ checked: 1, changed: 0, quiet: 1 });
    expect(state.writes).toHaveLength(0);
  });

  it("counts an unreachable panel as quiet and writes nothing", async () => {
    state.rows = [openOrder("a"), openOrder("b")];
    vi.mocked(getSmmOrderStatus).mockRejectedValue(new Error("timeout"));
    const result = await sweepBoostDeliveries();
    expect(result).toMatchObject({ checked: 2, changed: 0, quiet: 0, unanswered: 2 });
    expect(state.writes).toHaveLength(0);
  });

  it("never places a second order — the sweep only reads", async () => {
    state.rows = [openOrder("a")];
    vi.mocked(getSmmOrderStatus).mockResolvedValue(report("completed"));
    await sweepBoostDeliveries();
    expect(addSmmOrder).not.toHaveBeenCalled();
  });

  it("degrades to a skip when the open orders cannot be read", async () => {
    state.selectThrows = true;
    const result = await sweepBoostDeliveries();
    expect(result.skipped).toBe("could not read open orders");
    expect(result.checked).toBe(0);
  });

  it("caps how many orders one cron run asks about", async () => {
    state.rows = [];
    await sweepBoostDeliveries(7);
    expect(state.limits).toEqual([7]);
  });
});
