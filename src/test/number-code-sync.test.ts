import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { SINGLE_NUMBER_WINDOW } from "@/lib/refund-policy";

/**
 * The sweep that finishes number orders nobody is watching.
 *
 * A code only ever reached the order page while the page was open, so a customer
 * who closed the tab got refunded — and we still paid for the number. These pin
 * that the sweep delivers such a code, that it never writes over a refund, and
 * that it leaves the things it must not touch (rentals, eSIM, expired windows)
 * alone.
 */
const mocks = vi.hoisted(() => ({ checkSms: vi.fn(), activation: vi.fn() }));

vi.mock("@/lib/fleexa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fleexa")>();
  return { ...actual, checkFleexaSms: mocks.checkSms };
});

vi.mock("@/lib/bitcall", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bitcall")>();
  return { ...actual, getBitcallOtpActivation: mocks.activation };
});

let db: typeof import("@/db").db;
let schema: typeof import("@/db/schema");
let sweep: typeof import("@/lib/number-code-sync").sweepPendingNumberCodes;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  ({ db } = await import("@/db"));
  schema = await import("@/db/schema");
  ({ sweepPendingNumberCodes: sweep } = await import("@/lib/number-code-sync"));
});
const IDS = [
  "sweep-live", "sweep-gateway", "sweep-waiting", "sweep-broken",
  "sweep-refunded", "sweep-too-old", "sweep-rental", "sweep-esim",
  "sweep-already-refunded", "sweep-preview",
];

beforeEach(async () => {
  mocks.checkSms.mockReset();
  mocks.activation.mockReset();
  // The in-memory database persists across the cases in this file, so each one
  // starts from only the seeded rows -- otherwise an order left open by an
  // earlier test is the one the next test's mock happens to answer.
  for (const id of IDS) await db.delete(schema.orders).where(eq(schema.orders.id, id));
});
afterAll(() => vi.unstubAllEnvs());

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

async function insertOrder(id: string, overrides: Record<string, unknown> = {}) {
  await db.insert(schema.orders).values({
    id,
    reference: `REF-${id}`,
    userId: "demo-user",
    service: "numbers",
    productSlug: "vn-ng",
    productName: "Test number",
    planLabel: "Nigeria number",
    region: "NG",
    duration: SINGLE_NUMBER_WINDOW,
    amount: 1340,
    status: "active",
    provider: "fleexa",
    providerRequestId: `req-${id}`,
    otpCode: null,
    refundedAt: null,
    createdAt: minutesAgo(5),
    ...overrides,
  } as never);
}

async function readOrder(id: string) {
  const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
  return row;
}

describe("number code sweep", () => {
  it("delivers a code that arrived after the customer closed the page", async () => {
    await insertOrder("sweep-live");
    mocks.checkSms.mockResolvedValue({ code: "424242", message: "code 424242", status: "delivered" });

    expect(await sweep()).toMatchObject({ delivered: 1, failed: 0 });

    const saved = await readOrder("sweep-live");
    expect(saved).toMatchObject({ otpCode: "424242", status: "delivered" });
    // Delivered once, then out of scope: the next run must not ask again.
    expect(await sweep()).toMatchObject({ delivered: 0 });
  });

  it("reads a gateway activation and treats `received` as delivered", async () => {
    await insertOrder("sweep-gateway", { provider: "bitcall", providerRequestId: "act-9" });
    mocks.activation.mockResolvedValue({
      activationId: "act-9", phoneNumber: "+2348000000000", code: "778899",
      price: 0.4, currency: "USD", status: "received", serviceId: "pool-1",
      actions: { canResend: false, canReactivate: true },
    });

    await sweep();

    expect(mocks.activation).toHaveBeenCalledWith("act-9");
    expect(mocks.checkSms).not.toHaveBeenCalled();
    expect(await readOrder("sweep-gateway")).toMatchObject({ otpCode: "778899", status: "delivered" });
  });

  it("leaves the order open while the supplier has no code yet", async () => {
    await insertOrder("sweep-waiting");
    mocks.checkSms.mockResolvedValue({ code: null, message: null, status: "pending" });

    const result = await sweep();

    expect(result.delivered).toBe(0);
    expect(result.pending).toBeGreaterThanOrEqual(1);
    expect(await readOrder("sweep-waiting")).toMatchObject({ otpCode: null, status: "active" });
  });

  it("survives a supplier that cannot be read, and says so", async () => {
    await insertOrder("sweep-broken");
    mocks.checkSms.mockRejectedValue(new Error("supplier exploded"));

    const result = await sweep();

    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(await readOrder("sweep-broken")).toMatchObject({ otpCode: null, status: "active" });
  });

  it("never overwrites a refund that landed while the supplier was being asked", async () => {
    await insertOrder("sweep-refunded");
    mocks.checkSms.mockImplementationOnce(async () => {
      // The worst possible interleaving: the customer is refunded mid-read.
      await db.update(schema.orders)
        .set({ status: "refunded", refundedAt: new Date() })
        .where(eq(schema.orders.id, "sweep-refunded"));
      return { code: "111111", message: null, status: "delivered" };
    });

    const result = await sweep();

    expect(result.delivered).toBe(0);
    expect(await readOrder("sweep-refunded")).toMatchObject({ otpCode: null, status: "refunded" });
  });

  it("leaves expired windows, rentals and eSIM orders to the paths that own them", async () => {
    // Older than the delivery window: the auto-refund decides what happens next.
    await insertOrder("sweep-too-old", { createdAt: minutesAgo(24 * 60) });
    // A rental receives more than one code, so there is no single answer.
    await insertOrder("sweep-rental", { duration: "Rent for 30 days" });
    // eSIM is bought through the same gateway but has no code to poll for.
    await insertOrder("sweep-esim", { service: "esim", provider: "bitcall" });
    // Already refunded.
    await insertOrder("sweep-already-refunded", { status: "refunded", refundedAt: new Date() });
    // Preview orders have no supplier to ask.
    await insertOrder("sweep-preview", { provider: "preview" });

    mocks.checkSms.mockResolvedValue({ code: "999999", message: null, status: "delivered" });
    mocks.activation.mockResolvedValue({
      activationId: "x", phoneNumber: null, code: "123123", price: null, currency: null,
      status: "received", serviceId: null, actions: { canResend: false, canReactivate: false },
    });

    await sweep();

    for (const id of ["sweep-too-old", "sweep-rental", "sweep-esim", "sweep-already-refunded", "sweep-preview"]) {
      expect(await readOrder(id)).toMatchObject({ otpCode: null });
      expect((await readOrder(id))?.status).not.toBe("delivered");
    }
  });
});
