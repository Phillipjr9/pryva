import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * An eSIM order may only take money for a profile it can hand over.
 *
 * The supplier charges our balance on every purchase and provisions
 * asynchronously, so the route has four honest outcomes and these tests pin all
 * of them: delivered (record + charge once), provisioning (record, charge
 * nothing), refused (charge nothing, record nothing) and unknown (park it for a
 * human, charge nothing). A replay must never buy a second profile.
 */

const state = vi.hoisted(() => ({
  user: { id: "u1", email: "user@example.com", walletBalance: 50_000 } as { id: string; walletBalance: number } | null,
  sameOrigin: true,
  offer: null as null | { id: string; planId: string; name: string; region: string; dataLabel: string; validityLabel: string; countries: string[]; coverage: "catalog-country"; costNgn: number; priceNgn: number; purchasable: boolean },
  outcome: { kind: "refused", message: "nope" } as Record<string, unknown>,
  existing: null as Record<string, unknown> | null,
  balance: 50_000,
  inserts: [] as any[],
  debits: [] as any[],
  purchased: [] as any[],
  txError: null as Error | null,
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/lib/net", () => ({ isSameOriginMutation: () => state.sameOrigin }));
vi.mock("@/lib/rate-limit", () => ({ purchaseRateLimiter: async () => ({ allowed: true, unavailable: false }) }));
vi.mock("@/lib/fraud", () => ({
  purchaseVelocity: async () => ({ allowed: true, count: 0, limit: 20 }),
  recordFraudEvent: vi.fn(),
}));
vi.mock("@/lib/schedule-wallet-emails", () => ({ scheduleWalletEmails: vi.fn() }));
vi.mock("@/lib/referrals", () => ({ settleReferralRewards: async () => ({ credited: 0 }) }));

vi.mock("@/lib/esim-catalog", () => ({ findEsimOffer: async () => state.offer }));

vi.mock("@/lib/esim-fulfilment", () => ({
  purchaseEsim: async (offer: unknown) => {
    state.purchased.push(offer);
    return state.outcome;
  },
}));

vi.mock("@/lib/wallet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wallet")>();
  return {
    ...actual,
    debitWalletInTx: async (_tx: unknown, entry: unknown) => {
      state.debits.push(entry);
      if (state.txError) throw state.txError;
      return state.balance;
    },
  };
});

function chain(result: unknown) {
  const api: Record<string, unknown> = {
    from: () => api,
    where: () => api,
    limit: () => Promise.resolve(result),
    values: (value: unknown) => {
      state.inserts.push(value);
      return { onConflictDoNothing: () => Promise.resolve() };
    },
  };
  return api;
}

vi.mock("@/db", () => ({
  db: {
    // A projected select is the balance read; an unprojected one is an order
    // lookup. Conflating them makes every request look like a replay.
    select: (fields?: unknown) => chain(fields ? [{ balance: state.balance }] : state.existing ? [state.existing] : []),
    insert: () => chain(null),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      if (state.txError) throw state.txError;
      const tx = { select: () => chain([]), insert: () => chain(null) };
      return callback(tx);
    },
  },
}));

const { POST } = await import("@/app/api/esim/purchase/route");

function offer(overrides: Record<string, unknown> = {}) {
  return {
    id: "live-esim-0123456789abcdef0123",
    planId: "pln_live",
    name: "Nigeria Lite",
    region: "Africa",
    dataLabel: "1GB of data",
    validityLabel: "7 days",
    countries: ["Nigeria"],
    coverage: "catalog-country" as const,
    costNgn: 7_200,
    priceNgn: 9_800,
    purchasable: true,
    ...overrides,
  };
}

function request(body: unknown, origin = "https://pryva.test") {
  return new NextRequest("https://pryva.test/api/esim/purchase", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const valid = { offerId: "live-esim-0123456789abcdef0123", requestId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d" };

beforeEach(() => {
  state.user = { id: "u1", walletBalance: 50_000 };
  state.sameOrigin = true;
  state.offer = offer();
  state.outcome = { kind: "refused", message: "nope" };
  state.existing = null;
  state.balance = 50_000;
  state.inserts = [];
  state.debits = [];
  state.purchased = [];
  state.txError = null;
});

describe("POST /api/esim/purchase", () => {
  it("rejects anonymous and cross-origin calls", async () => {
    state.user = null;
    expect((await POST(request(valid))).status).toBe(401);
    state.user = { id: "u1", walletBalance: 50_000 };
    state.sameOrigin = false;
    expect((await POST(request(valid))).status).toBe(403);
  });

  it("rejects a malformed plan reference or request key", async () => {
    expect((await POST(request({ offerId: "", requestId: valid.requestId }))).status).toBe(400);
    expect((await POST(request({ offerId: valid.offerId, requestId: "nope" }))).status).toBe(400);
  });

  it("replays a duplicate request without buying anything", async () => {
    state.existing = { id: "o1", reference: "PRY1", productName: "Nigeria Lite", planLabel: "1GB · 7 days", service: "esim", amount: 9_800, provider: "bitcall", status: "active" };
    const response = await POST(request(valid));
    expect(response.status).toBe(200);
    expect((await response.json()).replayed).toBe(true);
    expect(state.purchased).toEqual([]);
    expect(state.debits).toEqual([]);
  });

  it("refuses a plan that is no longer listed", async () => {
    state.offer = null;
    expect((await POST(request(valid))).status).toBe(400);
    expect(state.purchased).toEqual([]);
  });

  it("refuses a plan the margin guard blocks, before spending", async () => {
    state.offer = offer({ purchasable: false });
    const response = await POST(request(valid));
    expect(response.status).toBe(503);
    expect(state.purchased).toEqual([]);
  });

  it("stops at the balance check when the wallet cannot cover it", async () => {
    state.user = { id: "u1", walletBalance: 1_000 };
    const response = await POST(request(valid));
    expect(response.status).toBe(402);
    expect(state.purchased).toEqual([]);
    expect(state.inserts).toEqual([]);
  });

  it("charges nothing when the supplier refuses", async () => {
    const response = await POST(request(valid));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toMatch(/nothing was charged/i);
    expect(state.inserts).toEqual([]);
    expect(state.debits).toEqual([]);
  });

  it("records a provisioning order without charging for it", async () => {
    state.outcome = { kind: "pending", providerRequestId: "prov-1" };
    const response = await POST(request(valid));
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.pending).toBe(true);
    expect(body.order.status).toBe("processing");
    expect(state.inserts[0]).toMatchObject({ status: "processing", provider: "bitcall", providerRequestId: "prov-1", amount: 9_800 });
    expect(state.debits).toEqual([]);
  });

  it("records the profile and charges once when the supplier delivers", async () => {
    state.outcome = {
      kind: "delivered",
      delivery: { provider: "bitcall", providerRequestId: "prov-2", iccid: "8944000000000000001", activationCode: "LPA:1$rsp.example$ABC", installUrl: "https://esim.example/install" },
    };
    const response = await POST(request(valid));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.order.status).toBe("active");
    expect(state.inserts[0]).toMatchObject({
      status: "active",
      esimIccid: "8944000000000000001",
      esimActivationCode: "LPA:1$rsp.example$ABC",
      esimInstallUrl: "https://esim.example/install",
      referenceCode: "8944000000000000001",
      amount: 9_800,
      provider: "bitcall",
    });
    expect(state.debits).toHaveLength(1);
    expect(state.debits[0]).toMatchObject({ amount: 9_800, type: "debit" });
  });

  it("parks an unknown purchase for a human and charges nothing", async () => {
    state.outcome = { kind: "unknown", message: "timeout" };
    const response = await POST(request(valid));
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.pending).toBe(true);
    expect(body.order.status).toBe("review");
    expect(state.inserts[0]).toMatchObject({ status: "review", provider: "bitcall" });
    expect(state.inserts[0].reconciliationNote).toMatch(/unknown/i);
    expect(state.debits).toEqual([]);
    // An unknown outcome is never retried: exactly one purchase attempt happened.
    expect(state.purchased).toHaveLength(1);
  });
});
