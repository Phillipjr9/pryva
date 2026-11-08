import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The operator's "is my key actually working?" endpoint.
 *
 * It exists to show which supplier catalogs are connected and healthy. OTP
 * checkout is Bitcall-only; Fleexa remains visible for diagnostics and rentals.
 * These tests pin the two properties that matter — the answer is honest, and
 * asking for it can never spend money.
 */
const gate = vi.hoisted(() => ({ allow: true, list: vi.fn(), buy: vi.fn(), cancel: vi.fn() }));
const fleexa = vi.hoisted(() => ({ configured: true, list: vi.fn(), buy: vi.fn() }));

vi.mock("@/lib/identity/admin-auth", () => ({
  authorizeAdminApi: async () =>
    gate.allow
      ? { user: { id: "admin" }, response: null }
      : { user: null, response: Response.json({ ok: false, error: "Unauthorized" }, { status: 401 }) },
}));

vi.mock("@/lib/providers/bitcall", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/bitcall")>();
  return {
    ...actual,
    isBitcallConfigured: () => true,
    bitcallKeyEnvironment: () => "live" as const,
    getBitcallBalance: async () => ({ balance: 12.5, currency: "USD" }),
    listBitcallOtpServices: gate.list,
    buyBitcallOtpActivation: gate.buy,
    cancelBitcallOtpActivation: gate.cancel,
  };
});

vi.mock("@/lib/providers/fleexa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/fleexa")>();
  return {
    ...actual,
    isFleexaConfigured: () => fleexa.configured,
    listFleexaSmsServices: fleexa.list,
    buyFleexaSmsNumber: fleexa.buy,
  };
});

vi.mock("@/lib/payments/exchange-rate", () => ({
  getUsdToNgnRate: async () => ({ rate: 1500, source: "override", fetchedAt: new Date().toISOString() }),
}));

const { GET } = await import("@/app/api/admin/suppliers/route");
const { FleexaError } = await import("@/lib/providers/fleexa");
const { clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");

function report(query = "") {
  return GET(new NextRequest(`https://pryva.test/api/admin/suppliers${query}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  clearOtpCatalogueCache();
  gate.allow = true;
  fleexa.configured = true;
  fleexa.list.mockResolvedValue([{ id: "svc-ng", country: "ng", name: "WhatsApp", priceNgn: 900, stock: 5 }]);
  fleexa.list.mockResolvedValue([]);
  gate.list.mockResolvedValue([
    { name: "WhatsApp", offers: [{ serviceId: "pool-ng", price: 0.4, currency: "USD", availableCount: 7 }] },
  ]);
});

afterEach(() => { vi.restoreAllMocks(); });

describe("supplier status endpoint", () => {
  it("refuses anyone who is not an administrator before doing any work", async () => {
    gate.allow = false;
    const response = await report();
    expect(response.status).toBe(401);
    expect(gate.list).not.toHaveBeenCalled();
    expect(fleexa.list).not.toHaveBeenCalled();
  });

  it("reports what each supplier can sell, and never spends anything", async () => {
    fleexa.list.mockResolvedValue([]);
    const body = await (await report("?country=ng")).json();

    expect(body).toMatchObject({
      ok: true,
      routing: { purchaseSupplier: "bitcall", diagnosticOrder: ["bitcall", "fleexa"], configured: { bitcall: true, fleexa: true } },
      gateway: { keyEnvironment: "live", balance: { amount: 12.5, currency: "USD", amountNgn: 18750 } },
      usdToNgn: { rate: 1500, source: "override" },
    });
    expect(body.destinations).toHaveLength(1);
    expect(body.destinations[0]).toMatchObject({
      country: "ng",
      sellable: true,
      suppliers: [
        // 0.40 USD at 1,500 is 600 naira — converted, never displayed raw.
        { supplier: "bitcall", configured: true, listed: 1, inStock: 1, cheapestNgn: 600, apps: ["WhatsApp"] },
        { supplier: "fleexa", configured: true, listed: 0, inStock: 0, errorCode: null },
      ],
    });

    // Read-only by construction: the point is to look, not to buy.
    expect(gate.buy).not.toHaveBeenCalled();
    expect(fleexa.buy).not.toHaveBeenCalled();
    expect(gate.cancel).not.toHaveBeenCalled();
  });

  it("does not call a Fleexa-only number plan sellable for OTP checkout", async () => {
    gate.list.mockResolvedValue([]);
    fleexa.list.mockResolvedValue([{ id: "svc-ng", country: "ng", name: "WhatsApp", priceNgn: 900, stock: 5 }]);

    const body = await (await report("?country=ng")).json();
    const nigeria = body.plans.find((plan: { slug: string }) => plan.slug === "vn-ng");

    expect(body.destinations[0].sellable).toBe(false);
    expect(nigeria).toMatchObject({ cheapest: null, clearsFloor: false });
  });

  it("shows the profit each plan still makes at Bitcall cost", async () => {
    const body = await (await report("?country=ng")).json();
    const nigeria = body.plans.find((plan: { slug: string }) => plan.slug === "vn-ng");

    // 0.40 USD at 1,500 = 600 naira cost against a 1,340 naira plan price.
    expect(nigeria).toMatchObject({
      slug: "vn-ng",
      country: "ng",
      ourPriceNgn: 1340,
      cheapest: { supplier: "bitcall", costNgn: 600 },
      profitNgn: 740,
      marginPct: 55.2,
      clearsFloor: true,
      blockedBy: null,
    });
  });

  it("says a plan does not clear the floor when the Bitcall cost is too high", async () => {
    gate.list.mockResolvedValue([
      { name: "WhatsApp", offers: [{ serviceId: "pool-ng", price: 1.2, currency: "USD", availableCount: 7 }] },
    ]);

    const body = await (await report("?country=ng")).json();
    const nigeria = body.plans.find((plan: { slug: string }) => plan.slug === "vn-ng");

    // 1,800 naira cost against 1,340 charged: refused, and the reason is named.
    expect(nigeria).toMatchObject({ cheapest: { costNgn: 1800 }, clearsFloor: false, blockedBy: "UNPROFITABLE" });
    expect(nigeria.profitNgn).toBe(-460);
  });

  it("reports a supplier failure as a code, never as an upstream message", async () => {
    gate.list.mockRejectedValue(new Error("gateway said: secret=b2c3d4"));

    const response = await report("?country=ng");
    const text = await response.clone().text();
    const body = await response.json();
    const bitcall = body.destinations[0].suppliers.find((entry: { supplier: string }) => entry.supplier === "bitcall");

    expect(bitcall.errorCode).toBe("UNKNOWN_ERROR");
    expect(text).not.toContain("secret=");
    expect(text).not.toContain("b2c3d4");
  });

  it("reports fleexa's own error code when its catalogue cannot be read", async () => {
    fleexa.list.mockRejectedValue(new FleexaError("upstream exploded", 502, "UPSTREAM_ERROR"));
    const body = await (await report("?country=ng")).json();
    const fleexaStatus = body.destinations[0].suppliers.find((entry: { supplier: string }) => entry.supplier === "fleexa");
    expect(fleexaStatus).toMatchObject({
      supplier: "fleexa",
      errorCode: "UPSTREAM_ERROR",
      listed: 0,
    });
  });

  it("answers for every sellable destination by default", async () => {
    const body = await (await report()).json();
    const codes = body.destinations.map((entry: { country: string }) => entry.country);
    expect(codes.sort()).toEqual(["ca", "de", "gb", "gh", "ng", "us"]);
  });
});
