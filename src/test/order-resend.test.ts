import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { SINGLE_NUMBER_WINDOW } from "@/lib/refund-policy";

/**
 * Asking for the code again.
 *
 * The cheapest resolution to "no code arrived" is a resend: it re-delivers from
 * the rental we already paid for, where a refund costs the sale *and* the
 * number. These pin the parts that make that safe to offer — ownership, the
 * capability being decided server-side, and an honest answer when the supplier
 * throttles us instead of a cheerful lie that the code was sent.
 */
const mocks = vi.hoisted(() => ({ resend: vi.fn(), user: vi.fn() }));

vi.mock("@/lib/bitcall", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bitcall")>();
  return {
    ...actual,
    isBitcallConfigured: () => true,
    resendBitcallOtpActivation: mocks.resend,
  };
});

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getCurrentUser: mocks.user };
});

let db: typeof import("@/db").db;
let schema: typeof import("@/db/schema");
let POST: typeof import("@/app/api/orders/[id]/resend/route").POST;
let BitcallError: typeof import("@/lib/bitcall").BitcallError;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  ({ db } = await import("@/db"));
  schema = await import("@/db/schema");
  ({ POST } = await import("@/app/api/orders/[id]/resend/route"));
  ({ BitcallError } = await import("@/lib/bitcall"));
});
afterAll(() => vi.unstubAllEnvs());

beforeEach(() => {
  mocks.resend.mockReset();
  mocks.resend.mockResolvedValue({
    activationId: "act-1", phoneNumber: "+2348000000000", code: null,
    price: null, currency: null, status: "waiting", serviceId: "pool-1",
    actions: { canResend: false, canReactivate: false },
  });
  mocks.user.mockResolvedValue({ id: "demo-user", email: "buyer@example.com", name: "Buyer", walletBalance: 0 });
});

const IDS = ["resend-ok", "resend-final", "resend-fleexa", "resend-esim", "resend-refunded", "resend-theirs"];

async function insertOrder(id: string, overrides: Record<string, unknown> = {}) {
  await db.delete(schema.orders).where(eq(schema.orders.id, id));
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
    provider: "bitcall",
    providerRequestId: `req-${id}`,
    otpCode: null,
    refundedAt: null,
    createdAt: new Date(Date.now() - 2 * 60_000),
    ...overrides,
  } as never);
}

function request(id: string, { origin = "https://pryva.test" } = {}) {
  return new Request(`https://pryva.test/api/orders/${id}/resend`, {
    method: "POST",
    headers: { host: "pryva.test", origin, "x-forwarded-proto": "https" },
  });
}

const context = (id: string) => ({ params: Promise.resolve({ id }) });

describe("resend the verification code", () => {
  it("sends it again for the signed-in owner", async () => {
    await insertOrder("resend-ok");

    const response = await POST(request("resend-ok"), context("resend-ok"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, resent: true });
    expect(mocks.resend).toHaveBeenCalledWith("req-resend-ok");
  });

  it("refuses a signed-out caller and a cross-origin one", async () => {
    await insertOrder("resend-ok");

    mocks.user.mockResolvedValueOnce(null);
    expect((await POST(request("resend-ok"), context("resend-ok"))).status).toBe(401);

    expect((await POST(request("resend-ok", { origin: "https://evil.test" }), context("resend-ok"))).status).toBe(403);
    expect(mocks.resend).not.toHaveBeenCalled();
  });

  it("cannot be used to touch somebody else's order", async () => {
    await insertOrder("resend-theirs", { userId: "someone-else" });

    const response = await POST(request("resend-theirs"), context("resend-theirs"));

    expect(response.status).toBe(404);
    expect(mocks.resend).not.toHaveBeenCalled();
  });

  it("says no, rather than pretending, where the supplier cannot resend", async () => {
    // One supplier has no resend endpoint, eSIM shares the gateway but has no
    // code, and a refunded order must not be re-armed.
    await insertOrder("resend-fleexa", { provider: "fleexa" });
    await insertOrder("resend-esim", { service: "esim" });
    await insertOrder("resend-refunded", { status: "refunded", refundedAt: new Date() });

    for (const id of ["resend-fleexa", "resend-esim", "resend-refunded"]) {
      const response = await POST(request(id), context(id));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ ok: false });
    }
    expect(mocks.resend).not.toHaveBeenCalled();
  });

  it("does not claim success when the supplier is throttling us", async () => {
    await insertOrder("resend-ok");
    mocks.resend.mockRejectedValueOnce(new BitcallError("Throttled", 409, "CANCELLATION_NOT_AVAILABLE_YET"));

    const response = await POST(request("resend-ok"), context("resend-ok"));

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ ok: false });
  });

  it("treats an outright refusal as final, not as a temporary hiccup", async () => {
    // A separate order: the route's own throttle (two a minute) is per order and
    // would answer 429 before the supplier ever saw the call.
    await insertOrder("resend-final");
    mocks.resend.mockRejectedValueOnce(new BitcallError("Gone", 409, "NOT_FOUND"));

    const response = await POST(request("resend-final"), context("resend-final"));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false });
  });
});
