import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reading a boost's delivery state back.
 *
 * The rule that matters: a boost row used to be write-once. `active` meant only
 * that the panel accepted the order, and nothing ever asked again, so a cancelled
 * or partially delivered order still told the customer they had what they paid
 * for. These tests pin the mapping, the guards that keep it from touching other
 * orders, and the promise that a failed read is never an error the page sees.
 */

const writes: Record<string, unknown>[] = [];

vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        writes.push(values);
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
  };
});

import { getSmmOrderStatus, isSmmPanelConfigured, SmmPanelError, type SmmOrderStatus } from "@/lib/smm-panel";
import {
  clearBoostStatusCache,
  orderStatusForState,
  syncBoostOrderStatus,
} from "@/lib/boost-status";

const boostOrder = {
  id: "order-1",
  provider: "smm",
  providerRequestId: "panel-42",
  status: "active",
  reconciliationNote: null,
};

function report(overrides: Partial<SmmOrderStatus> = {}): SmmOrderStatus {
  return {
    orderId: "panel-42",
    status: "in_progress",
    remains: 660,
    startCount: 1200,
    charge: 0.42,
    currency: "USD",
    ...overrides,
  };
}

beforeEach(() => {
  writes.length = 0;
  clearBoostStatusCache();
  vi.mocked(isSmmPanelConfigured).mockReturnValue(true);
  vi.mocked(getSmmOrderStatus).mockReset();
});

afterEach(() => {
  clearBoostStatusCache();
});

describe("mapping a panel state onto an order status", () => {
  it("turns a completed boost into `delivered`", () => {
    expect(orderStatusForState("completed")).toBe("delivered");
  });

  it("sends a partial or cancelled order to a human, never to `refunded`", () => {
    // Marking a row refunded without crediting the wallet would be a lie in the
    // other direction, so both land in review.
    expect(orderStatusForState("partial")).toBe("review");
    expect(orderStatusForState("canceled")).toBe("review");
  });

  it("leaves an in-flight answer alone", () => {
    expect(orderStatusForState("pending")).toBeNull();
    expect(orderStatusForState("in_progress")).toBeNull();
    expect(orderStatusForState("unknown")).toBeNull();
  });
});

describe("reading one order back", () => {
  it("records a completed delivery and reports progress", async () => {
    vi.mocked(getSmmOrderStatus).mockResolvedValue(report({ status: "completed", remains: 0 }));
    const result = await syncBoostOrderStatus(boostOrder);
    expect(getSmmOrderStatus).toHaveBeenCalledWith("panel-42");
    expect(result).toMatchObject({ synced: true, reportedState: "completed", status: "delivered" });
    expect(writes).toEqual([{ status: "delivered" }]);
  });

  it("explains a cancellation for the operator without refunding by itself", async () => {
    vi.mocked(getSmmOrderStatus).mockResolvedValue(report({ status: "canceled" }));
    const result = await syncBoostOrderStatus(boostOrder);
    expect(result.status).toBe("review");
    expect(writes).toHaveLength(1);
    expect(writes[0].status).toBe("review");
    expect(String(writes[0].reconciliationNote)).toMatch(/cancelled/);
    expect(String(writes[0].reconciliationNote)).toMatch(/no automatic refund/i);
  });

  it("does not overwrite a note an operator already wrote", async () => {
    vi.mocked(getSmmOrderStatus).mockResolvedValue(report({ status: "partial" }));
    await syncBoostOrderStatus({ ...boostOrder, reconciliationNote: "refund failed by hand" });
    expect(writes[0].reconciliationNote).toBeUndefined();
  });

  it("writes nothing while the order is still running", async () => {
    vi.mocked(getSmmOrderStatus).mockResolvedValue(report());
    const result = await syncBoostOrderStatus(boostOrder);
    expect(result).toMatchObject({ synced: true, reportedState: "in_progress", status: null, remains: 660 });
    expect(writes).toEqual([]);
  });

  it("keeps the stored status when the panel cannot be reached", async () => {
    vi.mocked(getSmmOrderStatus).mockRejectedValue(new SmmPanelError("down", 502, "UPSTREAM_ERROR"));
    const result = await syncBoostOrderStatus(boostOrder);
    expect(result.synced).toBe(false);
    expect(writes).toEqual([]);
  });
});

describe("orders this must never touch", () => {
  it("ignores an order that was not bought from the panel", async () => {
    await syncBoostOrderStatus({ ...boostOrder, provider: "fleexa" });
    expect(getSmmOrderStatus).not.toHaveBeenCalled();
  });

  it("ignores a boost the panel never accepted, because there is nothing to ask about", async () => {
    await syncBoostOrderStatus({ ...boostOrder, providerRequestId: null });
    expect(getSmmOrderStatus).not.toHaveBeenCalled();
  });

  it("never contradicts a settled row", async () => {
    for (const status of ["delivered", "refunded", "review", "expired"]) {
      await syncBoostOrderStatus({ ...boostOrder, status });
    }
    expect(getSmmOrderStatus).not.toHaveBeenCalled();
  });

  it("does nothing when boosting has no supplier configured", async () => {
    vi.mocked(isSmmPanelConfigured).mockReturnValue(false);
    await syncBoostOrderStatus(boostOrder);
    expect(getSmmOrderStatus).not.toHaveBeenCalled();
  });

  it("asks at most once a minute for the same order", async () => {
    vi.mocked(getSmmOrderStatus).mockResolvedValue(report());
    await syncBoostOrderStatus(boostOrder);
    await syncBoostOrderStatus(boostOrder);
    expect(getSmmOrderStatus).toHaveBeenCalledTimes(1);
    // A page the customer refreshes deliberately can bypass the window; nothing
    // else may.
    await syncBoostOrderStatus(boostOrder, { skipCooldown: true });
    expect(getSmmOrderStatus).toHaveBeenCalledTimes(2);
  });
});
