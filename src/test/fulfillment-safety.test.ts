import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findPlan, plansFor } from "@/lib/catalog";

/**
 * Fulfilment is the point where a customer's wallet meets a real supplier, so
 * these pin the two properties that matter: an allowlisted plan really buys,
 * and anything we cannot name precisely is refused *before* any call goes out.
 */
const provider = vi.hoisted(() => ({
  configured: true,
  buySms: vi.fn(),
  listServices: vi.fn(),
  buyRental: vi.fn(),
  listAreas: vi.fn(),
  cancelSms: vi.fn(),
}));

vi.mock("@/lib/fleexa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fleexa")>();
  return {
    ...actual,
    isFleexaConfigured: () => provider.configured,
    buyFleexaSmsNumber: provider.buySms,
    listFleexaSmsServices: provider.listServices,
    buyFleexaRental: provider.buyRental,
    listFleexaRentAreas: provider.listAreas,
    cancelFleexaSms: provider.cancelSms,
  };
});

const { cancelUpstream, fulfillPlan, isPlanFulfillable } = await import("@/lib/fulfillment");
const { clearOtpCatalogueCache } = await import("@/lib/otp-suppliers");

beforeEach(() => {
  vi.clearAllMocks();
  clearOtpCatalogueCache();
  provider.configured = true;
});
afterEach(() => { vi.restoreAllMocks(); });

/**
 * A catalog quote for every deliverable destination, priced far below what the
 * storefront charges so the margin guard passes. The guard reads the price from
 * this listing before buying, because the buy call only reports its price after
 * the owner's balance has already been spent.
 */
const SMS_SERVICES = ["ng", "us", "gb", "ca", "de", "gh"].map((country) => ({
  id: `svc-${country}`, country, name: country.toUpperCase(), priceNgn: 100, stock: 10,
}));

/** Plans we can deliver, and the exact provider arguments each one implies. */
const DELIVERABLE: Array<[slug: string, args: unknown]> = [
  // The app is passed too: a catalogue row names one, and buying it by country
  // alone could rent a pool that cannot receive the customer's code.
  ["vn-ng", { app: "NG", country: "ng" }],
  ["vn-us", { app: "US", country: "us" }],
  ["vn-uk", { app: "GB", country: "gb" }],
  ["vn-ca", { app: "CA", country: "ca" }],
  ["vn-de", { app: "DE", country: "de" }],
  ["vn-gh", { app: "GH", country: "gh" }],
];

/**
 * Plans that are advertised but cannot be delivered: no eSIM or proxy endpoint
 * exists, and the provider sells one unit per call so bundles cannot be
 * honoured. Each must fail closed.
 *
 * The four email tiers used to be listed here. They are no longer in the
 * catalogue at all, which is a strictly stronger position than failing closed --
 * see the dedicated test below.
 */
const UNDELIVERABLE = [
  "esim-ng-1", "esim-ng-5", "esim-africa", "esim-europe", "esim-us", "esim-global",
  "proxy-ng-1", "proxy-ng-5", "proxy-us-5", "proxy-eu-10", "proxy-ng-25",
  "vn-otp-5",
  "rent-ng-7",
];

describe("fulfilment", () => {
  it("refuses everything when no provider key is configured", async () => {
    provider.configured = false;
    await expect(fulfillPlan(findPlan("vn-ng")!)).rejects.toMatchObject({ code: "NO_API_KEY" });
    expect(provider.buySms).not.toHaveBeenCalled();
  });

  it.each(DELIVERABLE)("buys a real number for %s and returns the provider receipt", async (slug, args) => {
    provider.listServices.mockResolvedValue(SMS_SERVICES);
    provider.buySms.mockResolvedValue({
      requestId: "req-1", number: "+2348000000000", service: null,
      country: null, priceNgn: null, expiresAt: null, raw: {},
    });

    const result = await fulfillPlan(findPlan(slug)!);

    expect(provider.buySms).toHaveBeenCalledWith(args);
    expect(result).toMatchObject({
      provider: "fleexa",
      providerRequestId: "req-1",
      referenceCode: "+2348000000000",
      // The code arrives later; the order page polls for it.
      otpCode: null,
    });
    // No provider expiry, so fall back to the plan's own delivery window.
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  describe("margin guard", () => {
    const plan = findPlan("vn-ng")!;
    const receipt = { requestId: "req-1", number: "+2348000000000", service: null,
      country: null, priceNgn: null, expiresAt: null, raw: {} };
    /** Quote a cost for the destination we are about to buy. */
    function quote(priceNgn: number | null) {
      // Catalogues are cached briefly in production; a re-quote here has to be
      // seen, so the cache is cleared with it.
      clearOtpCatalogueCache();
      provider.listServices.mockResolvedValue([{ id: "svc-ng", country: "ng", priceNgn, stock: 10 }]);
    }

    it("refuses to spend when the provider costs more than we charge", async () => {
      quote(plan.price * 2);
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      await expect(fulfillPlan(plan)).rejects.toMatchObject({ code: "UNPROFITABLE", status: 503 });
      expect(provider.buySms).not.toHaveBeenCalled();
      // The owner must be able to see why; the customer never does.
      expect(error).toHaveBeenCalled();
      error.mockRestore();
    });

    it("refuses a margin below the floor but sells one that clears it", async () => {
      quote(Math.ceil(plan.price * 0.95));
      await expect(fulfillPlan(plan)).rejects.toMatchObject({ code: "UNPROFITABLE" });
      expect(provider.buySms).not.toHaveBeenCalled();

      quote(Math.floor(plan.price * 0.5));
      provider.buySms.mockResolvedValue(receipt);
      await expect(fulfillPlan(plan)).resolves.toMatchObject({ provider: "fleexa" });
      expect(provider.buySms).toHaveBeenCalledTimes(1);
    });

    it("refuses to spend when the provider does not report a price at all", async () => {
      quote(null);
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      await expect(fulfillPlan(plan)).rejects.toMatchObject({ code: "COST_UNKNOWN", status: 503 });
      expect(provider.buySms).not.toHaveBeenCalled();
      error.mockRestore();
    });

    it("refuses before any spend when no service matches the destination", async () => {
      provider.listServices.mockResolvedValue([{ id: "svc-zz", country: "zz", priceNgn: 100, stock: 10 }]);
      await expect(fulfillPlan(plan)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
      expect(provider.buySms).not.toHaveBeenCalled();
    });

    it("refuses when the matching destination is out of stock, before spending", async () => {
      provider.listServices.mockResolvedValue([{ id: "svc-ng", country: "ng", priceNgn: 100, stock: 0 }]);
      await expect(fulfillPlan(plan)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
      expect(provider.buySms).not.toHaveBeenCalled();
    });
  });

  it.each(UNDELIVERABLE)("fails closed on %s without contacting the provider", async (slug) => {
    const plan = findPlan(slug);
    expect(plan, `${slug} should exist in the catalog`).toBeDefined();

    await expect(fulfillPlan(plan!)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(isPlanFulfillable(slug)).toBe(false);
    expect(provider.buySms).not.toHaveBeenCalled();
    expect(provider.buyRental).not.toHaveBeenCalled();
  });

  /**
   * Email is free, so it is not a plan and must never reach fulfilment at all.
   * This is the replacement for the four "fails closed on email-*" cases that
   * used to run here: failing closed still had to advertise a price and a plan
   * the provider could not honour. Absence removes the whole class of mistake --
   * there is no price to render, no tier to promise, and a legacy slug from an
   * old link or a bookmarked checkout resolves to nothing rather than to a
   * purchase.
   */
  it("has no email plans, and a legacy email slug still cannot be fulfilled", () => {
    expect(plansFor("email-otp")).toEqual([]);

    for (const slug of ["email-24", "email-30", "email-bundle", "email-team"]) {
      expect(findPlan(slug), `${slug} should no longer exist in the catalog`).toBeUndefined();
      expect(isPlanFulfillable(slug), `${slug} must never be fulfillable`).toBe(false);
    }

    expect(provider.buySms).not.toHaveBeenCalled();
    expect(provider.buyRental).not.toHaveBeenCalled();
  });

  it("resolves a rental area from the provider's own catalog instead of guessing one", async () => {
    provider.listAreas.mockResolvedValue([
      { id: "area-gh", country: "Ghana", pricePerMonthNgn: 4000, stock: 2 },
      { id: "area-ng", country: "Nigeria", pricePerMonthNgn: 5000, stock: 3 },
    ]);
    provider.buyRental.mockResolvedValue({
      rentalId: "rent-1", number: "+2348000000001", months: 3, expiresAt: null, raw: {},
    });

    const result = await fulfillPlan(findPlan("rent-ng-90")!);

    expect(provider.buyRental).toHaveBeenCalledWith({ area: "area-ng", months: 3 });
    expect(result).toMatchObject({ provider: "fleexa", providerRequestId: "rent-1" });
  });

  it("refuses a rental with no matching coverage or no stock, before buying", async () => {
    provider.listAreas.mockResolvedValueOnce([{ id: "area-gh", country: "Ghana", pricePerMonthNgn: 4000, stock: 3 }]);
    await expect(fulfillPlan(findPlan("rent-ng-30")!)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });

    provider.listAreas.mockResolvedValueOnce([{ id: "area-ng", country: "Nigeria", pricePerMonthNgn: 5000, stock: 0 }]);
    await expect(fulfillPlan(findPlan("rent-ng-30")!)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });

    provider.listAreas.mockResolvedValueOnce([]);
    await expect(fulfillPlan(findPlan("rent-us-30")!)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });

    expect(provider.buyRental).not.toHaveBeenCalled();
  });

  it("cancels a single-verification number upstream after a failed charge", async () => {
    await cancelUpstream({
      provider: "fleexa", providerRequestId: "req-1",
      service: "numbers", duration: "Single verification · 20 min window",
    });
    expect(provider.cancelSms).toHaveBeenCalledWith("req-1");
  });

  it("never fires an SMS cancel at a rental id, which has no cancel endpoint", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await cancelUpstream({
      provider: "fleexa", providerRequestId: "rent-1", service: "numbers", duration: "Rent for 30 days",
    });
    expect(provider.cancelSms).not.toHaveBeenCalled();
    // Must be loud: an uncancelled rental is real money needing reconciliation.
    expect(error).toHaveBeenCalled();
  });

  it("leaves non-provider orders alone", async () => {
    await cancelUpstream({ provider: "manual", providerRequestId: null, service: "accounts" });
    await cancelUpstream({ provider: "fleexa", providerRequestId: null, service: "numbers" });
    expect(provider.cancelSms).not.toHaveBeenCalled();
  });

  it("reports fulfillability consistently with the mapping", () => {
    for (const [slug] of DELIVERABLE) expect(isPlanFulfillable(slug), slug).toBe(true);
    expect(isPlanFulfillable("rent-ng-30")).toBe(true);
    expect(isPlanFulfillable("rent-ng-90")).toBe(true);
    expect(isPlanFulfillable("rent-us-30")).toBe(true);
    expect(isPlanFulfillable("rent-uk-30")).toBe(true);
    expect(isPlanFulfillable("not-a-plan")).toBe(false);
    expect(isPlanFulfillable(undefined)).toBe(false);
    expect(isPlanFulfillable(null)).toBe(false);
  });
});
