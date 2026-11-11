import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findPlan } from "@/lib/services/catalog";

/**
 * Bitcall is the only supplier for single-use OTP checkout. These pin the safety
 * properties that matter: no Fleexa failover, no spend on unpriced or out-of-stock
 * offers, and no repeat purchase after an ambiguous Bitcall response.
 */
const fleexa = vi.hoisted(() => ({ configured: true, buy: vi.fn(), list: vi.fn() }));
const bitcall = vi.hoisted(() => ({
  configured: true,
  buy: vi.fn(),
  list: vi.fn(),
  cancel: vi.fn(),
  read: vi.fn(),
}));

vi.mock("@/lib/providers/fleexa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/fleexa")>();
  return {
    ...actual,
    isFleexaConfigured: () => fleexa.configured,
    buyFleexaSmsNumber: fleexa.buy,
    listFleexaSmsServices: fleexa.list,
  };
});

vi.mock("@/lib/providers/bitcall", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/bitcall")>();
  return {
    ...actual,
    isBitcallConfigured: () => bitcall.configured,
    buyBitcallOtpActivation: bitcall.buy,
    listBitcallOtpServices: bitcall.list,
    listBitcallOtpCountryEntries: async () => [],
    cancelBitcallOtpActivation: bitcall.cancel,
    getBitcallOtpActivation: bitcall.read,
  };
});

const { cancelUpstream, fulfillPlan } = await import("@/lib/services/fulfillment");
const { otpSupplierOrder, otpSupplierProbe, clearOtpCatalogueCache, otpOfferPublicId, readOtpOffersForSupplier } = await import("@/lib/services/numbers/otp-suppliers");
const { FleexaError } = await import("@/lib/providers/fleexa");
const { BitcallError } = await import("@/lib/providers/bitcall");
const { isAmbiguousOtpPurchase } = await import("@/lib/services/numbers/otp-suppliers");
const { clearRateCache } = await import("@/lib/payments/exchange-rate");

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
  return [{ countryCode: "NG_1", name: "WhatsApp", offers: [{ serviceId: "pool-1", price, currency, availableCount }] }];
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
  // Catalogues are cached briefly so a purchase does not re-read them; a test
  // that changes what a supplier sells has to start from a cold cache.
  clearOtpCatalogueCache();
  clearRateCache();
  fleexa.configured = true;
  bitcall.configured = true;
  vi.stubEnv("USD_NGN_RATE", String(RATE));
  vi.stubEnv("EUR_NGN_RATE", "");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  fleexa.list.mockResolvedValue([]);
  bitcall.list.mockResolvedValue([]);
  bitcall.buy.mockResolvedValue(activation);
  bitcall.cancel.mockResolvedValue({ activationId: "act-1", status: "cancelled" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("supplier order", () => {
  it("defaults to Bitcall first for OTP integrations", () => {
    expect(otpSupplierOrder()).toEqual(["bitcall", "fleexa"]);
  });

  it("lets an environment list reorder suppliers without dropping any", async () => {
    vi.resetModules();
    vi.stubEnv("OTP_PROVIDER_ORDER", " bitcall ");
    const fresh = await import("@/lib/services/numbers/otp-suppliers");
    expect(fresh.otpSupplierOrder()).toEqual(["bitcall", "fleexa"]);
    vi.resetModules();
  });
});

describe("Bitcall-only OTP checkout", () => {
  it("uses Bitcall even when Fleexa is cheaper and configured first", async () => {
    vi.stubEnv("OTP_PROVIDER_ORDER", "fleexa,bitcall");
    fleexa.list.mockResolvedValue(fleexaQuote(1));
    fleexa.buy.mockResolvedValue(receipt);
    bitcall.list.mockResolvedValue(bitcallQuote({ price: 0.05 }));

    await expect(fulfillPlan(plan)).resolves.toMatchObject({ provider: "bitcall" });
    expect(fleexa.list).not.toHaveBeenCalled();
    expect(fleexa.buy).not.toHaveBeenCalled();
    expect(bitcall.buy).toHaveBeenCalledOnce();
  });

  it("does not fall back to Fleexa when Bitcall has no offer", async () => {
    fleexa.list.mockResolvedValue(fleexaQuote(75));
    bitcall.list.mockResolvedValue([]);

    await expect(fulfillPlan(plan)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(fleexa.list).not.toHaveBeenCalled();
    expect(fleexa.buy).not.toHaveBeenCalled();
    expect(bitcall.buy).not.toHaveBeenCalled();
  });

  it("refuses an unpriced Bitcall offer instead of switching suppliers", async () => {
    fleexa.list.mockResolvedValue(fleexaQuote(75));
    bitcall.list.mockResolvedValue(bitcallQuote({ currency: "GBP" }));

    await expect(fulfillPlan(plan)).rejects.toMatchObject({ code: "COST_UNKNOWN" });
    expect(fleexa.buy).not.toHaveBeenCalled();
    expect(bitcall.buy).not.toHaveBeenCalled();
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

describe("Bitcall-only fulfilment", () => {
  it("buys only the selected app offer, using a fresh catalogue and durable callbacks", async () => {
    const selectedRef = "pool-whatsapp-selected";
    bitcall.list.mockResolvedValue([{ countryCode: "NG_1", name: "WhatsApp", offers: [
      { serviceId: "pool-cheaper-other-app", price: 0.01, currency: "USD", availableCount: 20 },
      { serviceId: selectedRef, price: 0.05, currency: "USD", availableCount: 5 },
    ] }]);
    const id = otpOfferPublicId("ng", selectedRef, "WhatsApp");
    const onOtpAttempt = vi.fn(async () => undefined);
    const onOtpAccepted = vi.fn(async () => undefined);

    await expect(fulfillPlan(plan, { otpOfferId: id, onOtpAttempt, onOtpAccepted }))
      .resolves.toMatchObject({ provider: "bitcall", providerRequestId: "act-1" });

    expect(bitcall.list).toHaveBeenCalledWith({});
    expect(bitcall.buy).toHaveBeenCalledTimes(1);
    expect(bitcall.buy).toHaveBeenCalledWith(selectedRef);
    expect(fleexa.buy).not.toHaveBeenCalled();
    expect(onOtpAttempt.mock.invocationCallOrder[0]).toBeLessThan(bitcall.buy.mock.invocationCallOrder[0]);
    expect(bitcall.buy.mock.invocationCallOrder[0]).toBeLessThan(onOtpAccepted.mock.invocationCallOrder[0]);
  });

  it("buys an unlabelled offer by the same opaque ID used in the catalogue", async () => {
    bitcall.list.mockResolvedValue([{ countryCode: "NG_1", name: null, offers: [
      { serviceId: "unlabelled-pool", price: 0.01, currency: "USD", availableCount: 5 },
    ] }]);
    const id = otpOfferPublicId("ng", "unlabelled-pool", null);
    await expect(fulfillPlan(plan, { otpOfferId: id, onOtpAttempt: async () => {}, onOtpAccepted: async () => {} }))
      .resolves.toMatchObject({ provider: "bitcall", providerRequestId: "act-1" });
    expect(bitcall.buy).toHaveBeenCalledOnce();
    expect(bitcall.buy).toHaveBeenCalledWith("unlabelled-pool");
  });

  it("does not substitute a different app pool when the chosen offer fails its margin guard", async () => {
    bitcall.list.mockResolvedValue([{ countryCode: "NG_1", name: "WhatsApp", offers: [
      { serviceId: "profitable-other-pool", price: 0.01, currency: "USD", availableCount: 20 },
      { serviceId: "selected-unprofitable", price: 2, currency: "USD", availableCount: 5 },
    ] }]);
    const onOtpAttempt = vi.fn(async () => undefined);
    const onOtpAccepted = vi.fn(async () => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(fulfillPlan(plan, {
      otpOfferId: otpOfferPublicId("ng", "selected-unprofitable", "WhatsApp"), onOtpAttempt, onOtpAccepted,
    })).rejects.toMatchObject({ code: "UNPROFITABLE" });
    expect(bitcall.buy).not.toHaveBeenCalled();
    expect(onOtpAttempt).not.toHaveBeenCalled();
  });

  it("requires claim callbacks before an app-specific spend can begin", async () => {
    bitcall.list.mockResolvedValue(bitcallQuote());
    await expect(fulfillPlan(plan, { otpOfferId: otpOfferPublicId("ng", "pool-1", "WhatsApp") }))
      .rejects.toMatchObject({ code: "OTP_CLAIM_REQUIRED" });
    expect(bitcall.buy).not.toHaveBeenCalled();
  });

  it("uses the exact Bitcall offer and records the returned app and activation", async () => {
    fleexa.list.mockResolvedValue(fleexaQuote(100));
    bitcall.list.mockResolvedValue(bitcallQuote());

    const result = await fulfillPlan(plan);

    expect(fleexa.list).not.toHaveBeenCalled();
    expect(fleexa.buy).not.toHaveBeenCalled();
    expect(bitcall.buy).toHaveBeenCalledWith("pool-1");
    expect(result).toMatchObject({
      provider: "bitcall",
      providerRequestId: "act-1",
      referenceCode: "+2348111111111",
      otpCode: null,
      serviceLabel: "WhatsApp",
    });
  });

  it("refuses a Bitcall offer that breaks the margin floor without supplier substitution", async () => {
    fleexa.list.mockResolvedValue(fleexaQuote(100));
    bitcall.list.mockResolvedValue(bitcallQuote({ price: 2 }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(fulfillPlan(plan)).rejects.toMatchObject({ code: "UNPROFITABLE" });
    expect(fleexa.buy).not.toHaveBeenCalled();
    expect(bitcall.buy).not.toHaveBeenCalled();
  });

  it("does not fall back to Fleexa when Bitcall refuses before purchase", async () => {
    fleexa.list.mockResolvedValue(fleexaQuote(100));
    bitcall.list.mockRejectedValue(new FleexaError("Rate limited", 429, "RATE_LIMITED"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(fulfillPlan(plan)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(fleexa.buy).not.toHaveBeenCalled();
    expect(bitcall.buy).not.toHaveBeenCalled();
  });

  it("does not spend on a cached quote when the fresh checkout read fails", async () => {
    bitcall.list.mockResolvedValue(bitcallQuote());
    expect((await readOtpOffersForSupplier("bitcall", "ng", "Nigeria")).offers).toHaveLength(1);
    bitcall.list.mockRejectedValue(new Error("feed unavailable"));
    await expect(fulfillPlan(plan)).rejects.toMatchObject({ code: "UNKNOWN_ERROR" });
    expect(bitcall.buy).not.toHaveBeenCalled();
  });

  it("uses the new quote rather than the cached quote at checkout", async () => {
    bitcall.list.mockResolvedValue(bitcallQuote());
    await readOtpOffersForSupplier("bitcall", "ng", "Nigeria");
    bitcall.list.mockResolvedValue(bitcallQuote({ price: 2 }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(fulfillPlan(plan)).rejects.toMatchObject({ code: "UNPROFITABLE" });
    expect(bitcall.buy).not.toHaveBeenCalled();
  });

  it.each(["RATE_LIMITED", "INVALID_API_KEY", "INSUFFICIENT_BALANCE", "PRODUCT_UNAVAILABLE", "NOT_FOUND"])(
    "stops after one %s refusal even when many other offers exist", async (code) => {
      bitcall.list.mockResolvedValue([{ countryCode: "NG_1", name: "WhatsApp", offers: Array.from({ length: 100 }, (_, i) => ({
        serviceId: `pool-${i}`, price: 0.01, currency: "USD", availableCount: 1,
      })) }]);
      bitcall.buy.mockRejectedValue(new BitcallError("Gateway request failed", 429, code, "request-123", [], 17));
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const error = await fulfillPlan(plan).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ code: "OTP_PROVIDER_REFUSED" });
      expect(isAmbiguousOtpPurchase(error)).toBe(false);
      expect(bitcall.buy).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith("Number purchase refused; not trying other offers", expect.objectContaining({ code, status: 429, requestId: "request-123", retryAfterSeconds: 17 }));
    },
  );

  it("holds an accepted activation for review if recording it fails", async () => {
    bitcall.list.mockResolvedValue(bitcallQuote());
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(fulfillPlan(plan, {
      otpOfferId: otpOfferPublicId("ng", "pool-1", "WhatsApp"),
      onOtpAttempt: async () => undefined,
      onOtpAccepted: async () => { throw new FleexaError("test", 503, "RATE_LIMITED"); },
    })).rejects.toMatchObject({ code: "AMBIGUOUS_PURCHASE" });
    expect(bitcall.buy).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("Number purchase outcome unknown; not retrying", expect.any(Object));
  });

  it.each(["activationId", "phoneNumber"])("does not treat an accepted activation missing %s as delivered", async (missing) => {
    bitcall.list.mockResolvedValue(bitcallQuote());
    bitcall.buy.mockResolvedValue({ ...activation, [missing]: null });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(fulfillPlan(plan)).rejects.toMatchObject({ code: "AMBIGUOUS_PURCHASE" });
    expect(bitcall.buy).toHaveBeenCalledTimes(1);
  });

  it("records an activation reference even when its phone number is missing", async () => {
    bitcall.list.mockResolvedValue(bitcallQuote());
    bitcall.buy.mockResolvedValue({ ...activation, phoneNumber: null });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const accepted = vi.fn().mockResolvedValue(undefined);
    await expect(fulfillPlan(plan, { onOtpAttempt: async () => undefined, onOtpAccepted: accepted }))
      .rejects.toMatchObject({ code: "AMBIGUOUS_PURCHASE" });
    expect(accepted).toHaveBeenCalledOnce();
    expect(accepted).toHaveBeenCalledWith("act-1");
  });

  it("never repeats or fails over after an ambiguous Bitcall purchase", async () => {
    fleexa.list.mockResolvedValue(fleexaQuote(100));
    bitcall.list.mockResolvedValue(bitcallQuote({ price: 0.05 }));
    bitcall.buy.mockRejectedValue(new Error("Ambiguous provider outcome"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(fulfillPlan(plan)).rejects.toMatchObject({ code: "AMBIGUOUS_PURCHASE" });
    expect(bitcall.buy).toHaveBeenCalledTimes(1);
    expect(fleexa.buy).not.toHaveBeenCalled();
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

  it("refuses to send an eSIM order to the number cancellation endpoint", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    // eSIM is bought through the same gateway and stores the same provider value.
    const released = await cancelUpstream({
      provider: "bitcall",
      providerRequestId: "esim-order-1",
      service: "esim",
      duration: "30 days",
    });

    expect(released).toBe(false);
    expect(bitcall.cancel).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
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
