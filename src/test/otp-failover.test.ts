import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findPlan } from "@/lib/catalog";

/**
 * Two suppliers now sell the same product, so the risk moves from "can we buy?"
 * to "did we buy twice?" and "was the second one actually usable?".
 *
 * These pin the three properties that make failover safe:
 *  • a switch is only ever made before a buy call, so it costs nothing;
 *  • an ambiguous purchase ends the search, because neither supplier takes an
 *    idempotency key and a second buy is a second number;
 *  • a supplier whose price cannot be converted is never sold.
 */
const fleexa = vi.hoisted(() => ({ configured: true, buy: vi.fn(), list: vi.fn() }));
const bitcall = vi.hoisted(() => ({
  configured: true,
  buy: vi.fn(),
  list: vi.fn(),
  cancel: vi.fn(),
  read: vi.fn(),
}));

vi.mock("@/lib/fleexa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fleexa")>();
  return {
    ...actual,
    isFleexaConfigured: () => fleexa.configured,
    buyFleexaSmsNumber: fleexa.buy,
    listFleexaSmsServices: fleexa.list,
  };
});

vi.mock("@/lib/bitcall", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bitcall")>();
  return {
    ...actual,
    isBitcallConfigured: () => bitcall.configured,
    buyBitcallOtpActivation: bitcall.buy,
    listBitcallOtpServices: bitcall.list,
    cancelBitcallOtpActivation: bitcall.cancel,
    getBitcallOtpActivation: bitcall.read,
  };
});

const { cancelUpstream, fulfillPlan } = await import("@/lib/fulfillment");
const { otpSupplierOrder, otpSupplierProbe } = await import("@/lib/otp-suppliers");
const { FleexaError } = await import("@/lib/fleexa");

const RATE = 1500;
const plan = findPlan("vn-ng")!;

/** A fleexa catalogue row for Nigeria at a naira cost we choose. */
function fleexaQuote(priceNgn: number | null, name = "WhatsApp") {
  return [{ id: "svc-ng", country: "ng", name, priceNgn, stock: 10 }];
}

/** A gateway pool offer priced in dollars; 0.01 USD is 15 naira at this rate. */
function bitcallQuote({
  price = 0.01,
  currency = "USD",
  availableCount = 25,
}: { price?: number; currency?: string; availableCount?: number } = {}) {
  return [{ name: "WhatsApp", offers: [{ serviceId: "pool-1", price, currency, availableCount }] }];
}

const receipt = {
  requestId: "req-fleexa",
  number: "+2348000000000",
  service: null,
  country: null,
  priceNgn: null,
  expiresAt: null,
  raw: {},
};

const activation = {
  activationId: "act-1",
  phoneNumber: "+2348111111111",
  price: null,
  currency: null,
  status: "pending",
};

beforeEach(() => {
  vi.clearAllMocks();
  fleexa.configured = true;
  bitcall.configured = true;
  vi.stubEnv("USD_NGN_RATE", String(RATE));
  fleexa.list.mockResolvedValue([]);
  bitcall.list.mockResolvedValue([]);
  bitcall.buy.mockResolvedValue(activation);
  bitcall.cancel.mockResolvedValue({ activationId: "act-1", status: "cancelled" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("supplier order", () => {
  it("defaults to fleexa first, then the gateway", () => {
    expect(otpSupplierOrder()).toEqual(["fleexa", "bitcall"]);
  });

  it("lets an environment list reorder suppliers without dropping any", async () => {
    vi.resetModules();
    vi.stubEnv("OTP_PROVIDER_ORDER", " bitcall ");
    const fresh = await import("@/lib/otp-suppliers");
    expect(fresh.otpSupplierOrder()).toEqual(["bitcall", "fleexa"]);
    vi.resetModules();
  });
});

describe("cost of a standing fallback", () => {
  it("never asks the second supplier when the first can already sell", async () => {
    fleexa.list.mockResolvedValue(fleexaQuote(100));
    fleexa.buy.mockResolvedValue(receipt);

    await expect(fulfillPlan(plan)).resolves.toMatchObject({ provider: "fleexa" });
    // A configured fallback must not tax every sale: no gateway round trip, no
    // shared rate budget, nothing that can slow a purchase that was already fine.
    expect(bitcall.list).not.toHaveBeenCalled();
    expect(bitcall.buy).not.toHaveBeenCalled();
  });

  it("asks the next supplier only once the first has nothing sellable", async () => {
    fleexa.list.mockResolvedValue(fleexaQuote(100, "WhatsApp"));
    // Its only row is out of stock, so the purchase has to look further.
    fleexa.list.mockResolvedValue([{ id: "svc-ng", country: "ng", name: "WhatsApp", priceNgn: 100, stock: 0 }]);
    bitcall.list.mockResolvedValue(bitcallQuote());

    await expect(fulfillPlan(plan)).resolves.toMatchObject({ provider: "bitcall" });
    expect(bitcall.list).toHaveBeenCalledOnce();
  });
});

describe("operator probe", () => {
  it("reports a supplier failure as a code, never as an upstream message", async () => {
    fleexa.list.mockRejectedValue(new FleexaError("declined sk-live-should-not-leak", 502, "INVALID_RESPONSE"));

    const probe = await otpSupplierProbe("fleexa", "ng", "Nigeria");

    expect(probe.offers).toEqual([]);
    expect(probe.errorCode).toBe("INVALID_RESPONSE");
    expect(JSON.stringify(probe)).not.toContain("sk-live-should-not-leak");
  });

  it("says which offers a working supplier currently has", async () => {
    bitcall.list.mockResolvedValue(bitcallQuote({ availableCount: 4 }));

    const probe = await otpSupplierProbe("bitcall", "ng", "Nigeria");

    expect(probe.errorCode).toBeNull();
    expect(probe.offers).toMatchObject([{ supplier: "bitcall", app: "WhatsApp", costNgn: 15, stock: 4 }]);
  });
});

describe("failing over", () => {
  it("buys from the gateway when the first supplier does not cover the country", async () => {
    fleexa.list.mockResolvedValue([]);
    bitcall.list.mockResolvedValue(bitcallQuote());

    const result = await fulfillPlan(plan);

    expect(fleexa.buy).not.toHaveBeenCalled();
    expect(bitcall.buy).toHaveBeenCalledWith("pool-1");
    expect(result).toMatchObject({
      provider: "bitcall",
      providerRequestId: "act-1",
      referenceCode: "+2348111111111",
      // The code arrives by polling; nothing is invented here.
      otpCode: null,
      // The pool only serves one app, so the order has to say which.
      serviceLabel: "WhatsApp",
    });
  });

  it("skips a supplier whose cost would break the floor and uses the cheaper one", async () => {
    fleexa.list.mockResolvedValue(fleexaQuote(plan.price * 2));
    bitcall.list.mockResolvedValue(bitcallQuote());
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(fulfillPlan(plan)).resolves.toMatchObject({ provider: "bitcall" });
    expect(fleexa.buy).not.toHaveBeenCalled();
    expect(bitcall.buy).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("fails over when the first supplier refuses before sending a request", async () => {
    fleexa.list.mockResolvedValue(fleexaQuote(100));
    fleexa.buy.mockRejectedValue(new FleexaError("Rate limited", 429, "RATE_LIMITED"));
    bitcall.list.mockResolvedValue(bitcallQuote());
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(fulfillPlan(plan)).resolves.toMatchObject({ provider: "bitcall" });
    expect(bitcall.buy).toHaveBeenCalledTimes(1);
  });

  it("never fails over after a purchase that may have happened", async () => {
    fleexa.list.mockResolvedValue(fleexaQuote(100));
    fleexa.buy.mockRejectedValue(new FleexaError("Incomplete receipt", 502, "INCOMPLETE_RECEIPT"));
    bitcall.list.mockResolvedValue(bitcallQuote());
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(fulfillPlan(plan)).rejects.toMatchObject({ code: "INCOMPLETE_RECEIPT" });
    // A second number for one order is worse than no number at all.
    expect(bitcall.buy).not.toHaveBeenCalled();
  });

  it("refuses a supplier price it cannot convert, instead of guessing a rate", async () => {
    fleexa.configured = false;
    bitcall.list.mockResolvedValue(bitcallQuote({ currency: "EUR" }));

    await expect(fulfillPlan(plan)).rejects.toMatchObject({ code: "COST_UNKNOWN", status: 503 });
    expect(bitcall.buy).not.toHaveBeenCalled();
  });

  it("treats an out-of-stock pool as unavailable before spending", async () => {
    fleexa.configured = false;
    bitcall.list.mockResolvedValue(bitcallQuote({ availableCount: 0 }));

    await expect(fulfillPlan(plan)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(bitcall.buy).not.toHaveBeenCalled();
  });
});

describe("cancelling upstream", () => {
  it("asks the supplier that actually sold the number", async () => {
    const released = await cancelUpstream({
      provider: "bitcall",
      providerRequestId: "act-1",
      service: "numbers",
      duration: plan.duration,
    });

    expect(released).toBe(true);
    expect(bitcall.cancel).toHaveBeenCalledWith("act-1");
  });

  it("refuses when a rental order is somehow marked with the wrong supplier", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const released = await cancelUpstream({
      provider: "bitcall",
      providerRequestId: "act-1",
      service: "numbers",
      duration: "Rent 7 days",
    });

    expect(released).toBe(false);
    expect(bitcall.cancel).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
