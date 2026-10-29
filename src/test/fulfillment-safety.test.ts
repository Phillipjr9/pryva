import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findPlan } from "@/lib/catalog";

/**
 * Fulfilment is the point where a customer's wallet meets a real supplier, so
 * these pin the two properties that matter: an allowlisted plan really buys,
 * and anything we cannot name precisely is refused *before* any call goes out.
 */
const provider = vi.hoisted(() => ({
  configured: true,
  buySms: vi.fn(),
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
    buyFleexaRental: provider.buyRental,
    listFleexaRentAreas: provider.listAreas,
    cancelFleexaSms: provider.cancelSms,
  };
});

const { cancelUpstream, fulfillPlan, isPlanFulfillable } = await import("@/lib/fulfillment");

beforeEach(() => {
  vi.clearAllMocks();
  provider.configured = true;
});
afterEach(() => { vi.restoreAllMocks(); });

/** Plans we can deliver, and the exact provider arguments each one implies. */
const DELIVERABLE: Array<[slug: string, args: unknown]> = [
  ["vn-ng", { country: "ng" }],
  ["vn-us", { country: "us" }],
  ["vn-uk", { country: "gb" }],
  ["vn-ca", { country: "ca" }],
  ["vn-de", { country: "de" }],
  ["vn-gh", { country: "gh" }],
];

/**
 * Plans that are advertised but cannot be delivered: no eSIM or proxy endpoint
 * exists, provider email products carry no duration so a 24-hour and a 30-day
 * inbox are indistinguishable at purchase time, and the provider sells one unit
 * per call so bundles cannot be honoured. Each must fail closed.
 */
const UNDELIVERABLE = [
  "esim-ng-1", "esim-ng-5", "esim-africa", "esim-europe", "esim-us", "esim-global",
  "proxy-ng-1", "proxy-ng-5", "proxy-us-5", "proxy-eu-10", "proxy-ng-25",
  "email-24", "email-30", "email-bundle", "email-team",
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

  it.each(UNDELIVERABLE)("fails closed on %s without contacting the provider", async (slug) => {
    const plan = findPlan(slug);
    expect(plan, `${slug} should exist in the catalog`).toBeDefined();

    await expect(fulfillPlan(plan!)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(isPlanFulfillable(slug)).toBe(false);
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
