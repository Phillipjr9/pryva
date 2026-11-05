import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

/**
 * A boost status read must not reopen a settled order.
 *
 * `syncBoostOrderStatus` checks the row, asks the panel, then writes. The panel
 * call takes seconds, and in that window an admin refund can credit the wallet
 * and mark the order `refunded` (`/api/admin/refunds` does exactly that for any
 * non-processing order). The check had already happened, so the stale answer
 * overwrote the settled row -- with the note "no automatic refund was issued" on
 * a wallet that had just been issued one, and a row that reads `review` is a row
 * support is invited to act on again.
 *
 * These run against the in-memory database rather than a fake, because the whole
 * point is what the row says at the moment of the write.
 */

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  configured: vi.fn(() => true),
}));

vi.mock("@/lib/providers/smm-panel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/smm-panel")>();
  return {
    ...actual,
    isSmmPanelConfigured: mocks.configured,
    getSmmOrderStatus: mocks.status,
  };
});

let db: typeof import("@/db").db;
let schema: typeof import("@/db/schema");
let boostStatus: typeof import("@/lib/services/boosts/boost-status");

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  ({ db } = await import("@/db"));
  schema = await import("@/db/schema");
  boostStatus = await import("@/lib/services/boosts/boost-status");
});

const IDS = ["boost-race-refunded", "boost-race-open"];

beforeEach(async () => {
  for (const id of IDS) await db.delete(schema.orders).where(eq(schema.orders.id, id));
  boostStatus.clearBoostStatusCache();
  mocks.configured.mockReturnValue(true);
  mocks.status.mockReset();
});

async function insertBoost(id: string, overrides: Record<string, unknown> = {}) {
  await db.insert(schema.orders).values({
    id,
    reference: `REF-${id}`,
    userId: "demo-user",
    service: "social",
    productSlug: "smm-ig-followers",
    productName: "Instagram followers",
    planLabel: "1,000 followers",
    region: "Not country-specific",
    duration: "Until delivered",
    amount: 1_200,
    status: "active",
    provider: "smm",
    providerRequestId: `panel-${id}`,
    quantity: 1_000,
    ...overrides,
  } as never);
}

async function readBoost(id: string) {
  const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
  return row;
}

function panelReport(status: string, overrides: Record<string, unknown> = {}) {
  return { orderId: "panel-x", status, remains: 0, startCount: 1_000, charge: 0.5, currency: "USD", ...overrides };
}

describe("settling a boost while the panel is being asked", () => {
  it("leaves a refund that landed mid-read refunded", async () => {
    await insertBoost("boost-race-refunded");
    // The caller's copy is the row as it looked before the call: still open.
    const order = await readBoost("boost-race-refunded");

    mocks.status.mockImplementation(async () => {
      await db
        .update(schema.orders)
        .set({ status: "refunded", refundedAt: new Date(), reconciliationNote: "Refunded by hand" })
        .where(eq(schema.orders.id, "boost-race-refunded"));
      return panelReport("canceled") as never;
    });

    const result = await boostStatus.syncBoostOrderStatus(order);

    expect(result.synced).toBe(true);
    // Nothing was written, so nothing may be reported as changed.
    expect(result.status).toBeNull();

    const saved = await readBoost("boost-race-refunded");
    expect(saved.status).toBe("refunded");
    // The operator's reason outranks a panel answer that arrived too late.
    expect(saved.reconciliationNote).toBe("Refunded by hand");
  });

  it("writes the panel's answer while the row is genuinely still open", async () => {
    await insertBoost("boost-race-open");
    const order = await readBoost("boost-race-open");
    mocks.status.mockResolvedValue(panelReport("canceled") as never);

    const result = await boostStatus.syncBoostOrderStatus(order);

    expect(result.status).toBe("review");
    expect(await readBoost("boost-race-open")).toMatchObject({ status: "review" });
  });

  it("counts a declined write as quiet, not as a change", async () => {
    await insertBoost("boost-race-refunded");

    mocks.status.mockImplementation(async () => {
      await db
        .update(schema.orders)
        .set({ status: "refunded", refundedAt: new Date() })
        .where(eq(schema.orders.id, "boost-race-refunded"));
      return panelReport("canceled") as never;
    });

    // The sweep is the same read with a snapshot taken even earlier.
    const result = await boostStatus.sweepBoostDeliveries();

    expect(result).toMatchObject({ checked: 1, changed: 0, review: 0, quiet: 1, unanswered: 0 });
    expect(await readBoost("boost-race-refunded")).toMatchObject({ status: "refunded" });
  });
});
