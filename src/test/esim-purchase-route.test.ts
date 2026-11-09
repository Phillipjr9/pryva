import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * An eSIM order may only take money for a profile it can hand over.
 *
 * The supplier charges our balance on every purchase and provisions
 * asynchronously, so the route has four honest outcomes and these tests pin all
 * of them: delivered (record + charge once), provisioning (record, charge
 * nothing), refused (cancelled without a charge) and unknown (park it for a
 * human, charge nothing). A replay must never buy a second profile.
 */

const state = vi.hoisted(() => ({
  user: { id: "u1", email: "user@example.com", walletBalance: 50_000 } as { id: string; walletBalance: number } | null,
  sameOrigin: true,
  preview: false,
  offer: null as null | { id: string; planId: string; name: string; region: string; dataLabel: string; validityLabel: string; countries: string[]; coverage: "catalog-country"; costNgn: number; priceNgn: number; purchasable: boolean },
  outcome: { kind: "refused", message: "nope" } as Record<string, unknown>,
  existing: null as Record<string, unknown> | null,
  balance: 50_000,
  inserts: [] as any[],
  updates: [] as any[],
  recheck: vi.fn(),
  purchaseWait: null as Promise<void> | null,
  debits: [] as any[],
  purchased: [] as any[],
  txError: null as Error | null,
}));

vi.mock("@/lib/identity/auth", () => ({ getCurrentUser: async () => state.user, requireAuthApi: async () => state.user }));
vi.mock("@/lib/platform/demo-policy", () => ({ isPreviewDatabase: () => state.preview }));
vi.mock("@/lib/platform/net", () => ({ isSameOriginMutation: () => state.sameOrigin }));
vi.mock("@/lib/platform/rate-limit", async (importOriginal) => {
  // Keep the real module: other limiters are constructed when a route imports
  // a money module, and a factory that omits them fails at import time.
  const actual = await importOriginal<typeof import("@/lib/platform/rate-limit")>();
  return { ...actual, purchaseRateLimiter: async () => ({ allowed: true, unavailable: false }) };
});
vi.mock("@/lib/admin/fraud", () => ({
  purchaseVelocity: async () => ({ allowed: true, count: 0, limit: 20 }),
  recordFraudEvent: vi.fn(),
}));
vi.mock("@/lib/email/schedule-wallet-emails", () => ({ scheduleWalletEmails: vi.fn() }));
vi.mock("@/lib/content/referrals", () => ({ settleReferralRewards: async () => ({ credited: 0 }) }));

vi.mock("@/lib/services/esim/esim-catalog", () => ({
  findEsimOffer: async () => state.offer,
  recheckEsimOffer: state.recheck,
  esimOfferTerms: (value: { includesPhoneNumber?: boolean }) => (value.includesPhoneNumber ? "b" : "a").repeat(24),
}));

vi.mock("@/lib/services/esim/esim-fulfilment", () => ({
  purchaseEsim: async (offer: unknown) => {
    state.purchased.push(offer);
    if (state.purchaseWait) await state.purchaseWait;
    return state.outcome;
  },
}));

vi.mock("@/lib/payments/wallet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/payments/wallet")>();
  return {
    ...actual,
    debitWalletInTx: async (_tx: unknown, entry: unknown) => {
      if (state.txError) throw state.txError;
      state.debits.push(entry);
      return state.balance;
    },
  };
});

function selectChain(result: unknown) {
  const api: Record<string, unknown> = {
    from: () => api,
    where: () => api,
    for: () => api,
    limit: () => Promise.resolve(result),
  };
  return api;
}

function insertChain() {
  return {
    values: (value: Record<string, unknown>) => ({
      onConflictDoNothing: () => ({
        returning: async () => {
          if (state.existing) return [];
          state.inserts.push({ ...value });
          state.existing = { ...value };
          return [{ id: value.id }];
        },
      }),
    }),
  };
}

function updateChain() {
  return {
    set: (values: Record<string, unknown>) => ({
      where: () => {
        state.updates.push({ ...values });
        if (state.existing) Object.assign(state.existing, values);
        const result = state.existing ? [{ id: state.existing.id }] : [];
        return Object.assign(Promise.resolve(result), { returning: async () => result });
      },
    }),
  };
}

vi.mock("@/db", () => ({
  db: {
    // Snapshot the select at call time, as two racing requests can both observe
    // no order before either reaches the unique-index claim.
    select: (fields?: unknown) => selectChain(fields ? [{ balance: state.balance }] : state.existing ? [{ ...state.existing }] : []),
    insert: () => insertChain(),
    update: () => updateChain(),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      const before = state.existing ? { ...state.existing } : null;
      try {
        return await callback({ update: () => updateChain(), select: () => selectChain([{ suspendedAt: null, deletedAt: null }]) });
      } catch (error) {
        state.existing = before;
        throw error;
      }
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

const valid = { offerId: "live-esim-0123456789abcdef0123", requestId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", expectedPriceNgn: 9_800, expectedTerms: "a".repeat(24) };

beforeEach(() => {
  state.preview = false;
  state.user = { id: "u1", walletBalance: 50_000 };
  state.sameOrigin = true;
  state.offer = offer();
  state.outcome = { kind: "refused", message: "nope" };
  state.existing = null;
  state.balance = 50_000;
  state.inserts = [];
  state.updates = [];
  state.recheck.mockReset();
  state.recheck.mockImplementation(async () => state.offer);
  state.purchaseWait = null;
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

  it("never buys from the network in an in-memory preview", async () => {
    state.preview = true;
    const response = await POST(request(valid));
    expect(response.status).toBe(503);
    expect(state.purchased).toEqual([]);
    expect(state.debits).toEqual([]);
  });

  it("rejects a malformed plan reference or request key", async () => {
    expect((await POST(request({ offerId: "", requestId: valid.requestId }))).status).toBe(400);
    expect((await POST(request({ offerId: valid.offerId, requestId: "nope" }))).status).toBe(400);
  });

  it("rejects a requested phone number or any other unsupported option before buying", async () => {
    for (const extra of [
      { phoneNumber: "+15551234567" },
      { selectedNumber: "+15551234567" },
      { price: 1 },
    ]) {
      const response = await POST(request({ ...valid, ...extra }));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/options are not supported/i);
    }
    expect(state.purchased).toEqual([]);
    expect(state.inserts).toEqual([]);
    expect(state.debits).toEqual([]);
  });

  it("does not claim a selected number was honoured when replaying an existing order", async () => {
    state.existing = { id: "o1", reference: "PRY1", status: "active" };
    const response = await POST(request({ ...valid, phoneNumber: "+15551234567" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/check your orders/i);
    expect(state.purchased).toEqual([]);
    expect(state.inserts).toEqual([]);
    expect(state.debits).toEqual([]);
  });

  it("replays a duplicate request without buying anything", async () => {
    state.existing = { id: "o1", reference: "PRY1", productName: "Nigeria Lite", planLabel: "1GB · 7 days", service: "esim", productSlug: valid.offerId, amount: 9_800, provider: "bitcall", status: "active" };
    const response = await POST(request(valid));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.replayed).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/bitcall|supplier/i);
    expect(state.purchased).toEqual([]);
    expect(state.debits).toEqual([]);
  });

  it("rejects reuse of a request key for a different service, offer, price, or terms", async () => {
    const intent = `esim:v1:${createHash("sha256").update(JSON.stringify([valid.offerId, valid.expectedPriceNgn, valid.expectedTerms])).digest("hex")}`;
    const order = { id: "o1", reference: "PRY1", status: "active", service: "esim", productSlug: valid.offerId, requestIntent: intent };
    for (const [existing, body] of [
      [{ ...order, service: "numbers" }, valid],
      [{ ...order, productSlug: "another-offer" }, valid],
      [order, { ...valid, expectedPriceNgn: 9_900 }],
      [order, { ...valid, expectedTerms: "b".repeat(24) }],
      [order, { offerId: valid.offerId, requestId: valid.requestId }],
    ] as const) {
      state.existing = existing;
      const response = await POST(request(body));
      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/different order/i);
    }
    expect(state.purchased).toEqual([]);
  });

  it("checks a conflicting winner's intent after the unique claim loses", async () => {
    state.recheck.mockImplementation(async () => {
      state.existing = { id: "winner", status: "review", service: "esim", productSlug: valid.offerId, requestIntent: "esim:v1:different" };
      return state.offer;
    });
    const response = await POST(request(valid));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/different order/i);
    expect(state.purchased).toEqual([]);
  });

  it("does not report a cancelled attempt as a successful purchase", async () => {
    state.existing = { id: "o1", status: "cancelled", service: "esim", productSlug: valid.offerId, reconciliationNote: "Supplier refused the eSIM purchase; nothing was charged." };
    const body = await (await POST(request(valid))).json();
    expect(body).toMatchObject({ ok: false, safeToRetry: true });
    expect(state.purchased).toEqual([]);
  });

  it("does not start an old attempt when a client requests recovery only", async () => {
    const response = await POST(request({ ...valid, recoveryOnly: true }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/contact support/i);
    expect(state.purchased).toEqual([]);
    expect(state.inserts).toEqual([]);
  });

  it("requires a valid displayed price for a new purchase, but can replay old requests", async () => {
    for (const expectedPriceNgn of [undefined, null, 0, -1, 9.5, "9800"]) {
      const response = await POST(request({ ...valid, expectedPriceNgn }));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/reload.*price/i);
    }
    expect(state.purchased).toEqual([]);
    expect(state.inserts).toEqual([]);
    state.existing = { id: "o1", reference: "PRY1", status: "active", amount: 9_800, service: "esim", productSlug: valid.offerId };
    expect((await POST(request({ offerId: valid.offerId, requestId: valid.requestId }))).status).toBe(200);
    expect(state.purchased).toEqual([]);
  });

  it("requires confirmed plan details, and stops if they change even at the same price", async () => {
    for (const expectedTerms of [undefined, "", "not-a-fingerprint", "x".repeat(24)]) {
      expect((await POST(request({ ...valid, expectedTerms }))).status).toBe(400);
    }
    state.recheck.mockResolvedValue(offer({ includesPhoneNumber: true }));
    const response = await POST(request(valid));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/plan details changed/i);
    expect(state.purchased).toEqual([]);
    expect(state.inserts).toEqual([]);
  });

  it("rechecks price before spending and requires the customer to confirm a change", async () => {
    state.recheck.mockResolvedValue(offer({ priceNgn: 10_200 }));
    const response = await POST(request(valid));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/price changed/i);
    expect(state.purchased).toEqual([]);
    expect(state.inserts).toEqual([]);
    expect(state.debits).toEqual([]);
  });

  it("fails closed when the current quote is missing, unprofitable or unavailable", async () => {
    for (const fresh of [null, offer({ purchasable: false })]) {
      state.recheck.mockResolvedValue(fresh);
      expect((await POST(request(valid))).status).toBe(503);
    }
    state.recheck.mockRejectedValue(new Error("down"));
    expect((await POST(request(valid))).status).toBe(503);
    expect(state.purchased).toEqual([]);
    expect(state.inserts).toEqual([]);
  });

  it("claims a request before spending, so simultaneous duplicate submits buy only once", async () => {
    let releaseRecheck!: () => void;
    let releasePurchase!: () => void;
    const recheckWait = new Promise<void>((resolve) => { releaseRecheck = resolve; });
    state.purchaseWait = new Promise<void>((resolve) => { releasePurchase = resolve; });
    state.recheck.mockImplementation(async () => { await recheckWait; return state.offer; });
    const first = POST(request(valid));
    const second = POST(request(valid));
    await vi.waitFor(() => expect(state.recheck).toHaveBeenCalledTimes(2));
    releaseRecheck();
    await vi.waitFor(() => expect(state.purchased).toHaveLength(1));
    const replay = await Promise.race([first, second]);
    expect((await replay.json()).replayed).toBe(true);
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0].status).toBe("review");
    releasePurchase();
    await Promise.all([first, second]);
    expect(state.purchased).toHaveLength(1);
  });

  it("retains an uncharged review claim when recording a delivered profile fails", async () => {
    state.outcome = {
      kind: "delivered",
      delivery: { provider: "bitcall", providerRequestId: "prov-2", iccid: "8944000000000000001", activationCode: "LPA:1$rsp.example$ABC", installUrl: null },
    };
    state.txError = new Error("database down");
    const response = await POST(request(valid));
    expect(response.status).toBe(409);
    expect(state.existing).toMatchObject({ status: "review", providerRequestId: "prov-2" });
    expect(state.existing).not.toHaveProperty("esimActivationCode");
    expect(state.debits).toEqual([]);
    expect((await POST(request(valid))).status).toBe(200);
    expect(state.purchased).toHaveLength(1);
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
    expect(state.inserts[0]).toMatchObject({ status: "review" });
    expect(state.updates.at(-1)).toMatchObject({ status: "cancelled" });
    expect(state.debits).toEqual([]);
  });

  it("records a provisioning order without charging for it", async () => {
    state.outcome = { kind: "pending", providerRequestId: "prov-1" };
    const response = await POST(request(valid));
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.pending).toBe(true);
    expect(body.order.status).toBe("processing");
    expect(JSON.stringify(body)).not.toMatch(/bitcall|supplier/i);
    expect(state.inserts[0]).toMatchObject({ status: "review", provider: "bitcall", amount: 9_800 });
    expect(state.updates.at(-1)).toMatchObject({ status: "processing", providerRequestId: "prov-1" });
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
    expect(JSON.stringify(body)).not.toMatch(/bitcall|supplier/i);
    expect(state.inserts[0]).toMatchObject({ status: "review", amount: 9_800, provider: "bitcall" });
    expect(state.updates.at(-1)).toMatchObject({
      status: "active",
      esimIccid: "8944000000000000001",
      esimActivationCode: "LPA:1$rsp.example$ABC",
      esimInstallUrl: "https://esim.example/install",
      referenceCode: "8944000000000000001",
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
    expect(JSON.stringify(body)).not.toMatch(/bitcall|supplier/i);
    expect(state.inserts[0]).toMatchObject({ status: "review", provider: "bitcall" });
    expect(state.updates.at(-1).reconciliationNote).toMatch(/unknown/i);
    expect(state.debits).toEqual([]);
    // An unknown outcome is never retried: exactly one purchase attempt happened.
    expect(state.purchased).toHaveLength(1);
  });
});
