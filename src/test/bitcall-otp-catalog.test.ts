import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/services/numbers/otp-suppliers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/numbers/otp-suppliers")>();
  return { ...actual, readOtpOffersForSupplier: state.read };
});

import {
  bitcallOtpItemsForCountry,
  findOtpCheckoutOffer,
} from "@/lib/services/numbers/otp-catalog";
import { otpOfferPublicId } from "@/lib/services/numbers/otp-suppliers";
import type { OtpOffer } from "@/lib/services/numbers/otp-suppliers";

const offers: OtpOffer[] = [
  { supplier: "bitcall", ref: "private-service-id-1", country: "ng", app: "WhatsApp", costNgn: 250, stock: 3 },
  { supplier: "bitcall", ref: "private-service-id-2", country: "ng", app: "WhatsApp", costNgn: 400, stock: 20 },
  { supplier: "bitcall", ref: "private-service-id-3", country: "ng", app: "Signal", costNgn: 500, stock: 0 },
  { supplier: "bitcall", ref: "private-service-id-4", country: "ng", app: "Unknown app", costNgn: 250, stock: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  state.read.mockResolvedValue({ offers, errorCode: null });
});

describe("Bitcall app-specific OTP catalogue", () => {
  it("keeps all app pools and hides provider references and costs", () => {
    const items = bitcallOtpItemsForCountry(offers, "ng", "Nigeria");
    expect(items.map((item) => item.name)).toEqual(["Signal", "Unknown app", "WhatsApp", "WhatsApp"]);
    expect(items.filter((item) => item.name === "WhatsApp").map((item) => item.stock)).toEqual([3, 20]);
    expect(new Set(items.map((item) => item.id)).size).toBe(4);
    const whatsapp = items.find((item) => item.name === "WhatsApp")!;
    expect(whatsapp).toMatchObject({
      source: "live",
      category: "verification",
      stock: 3,
      price: 1058,
      action: { label: "Choose service", href: expect.stringContaining("?country=ng") },
    });
    const signal = items.find((item) => item.name === "Signal")!;
    expect(signal).toMatchObject({ price: null, stock: 0, action: null });
    const payload = JSON.stringify(items);
    expect(payload).not.toContain("private-service-id");
    expect(payload).not.toContain("costNgn");
    expect(payload).not.toContain("250");
  });

  it("lists and resolves an offer whose id names no app", async () => {
    // `if (!app) continue` was the quietest way to lose a country's inventory:
    // the read succeeds, nothing errors, and the shelf is simply empty. The offer
    // is real stock, so it is listed under a neutral label and can still be bought.
    const unlabelled: OtpOffer = { supplier: "bitcall", ref: "opaque_ref_1", country: "ng", app: null, costNgn: 250, stock: 5 };
    const items = bitcallOtpItemsForCountry([unlabelled], "ng", "Nigeria");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: "Verification number",
      source: "live",
      stock: 5,
      price: 1058,
      action: { label: "Choose service" },
    });
    expect(JSON.stringify(items)).not.toContain("opaque_ref_1");

    state.read.mockResolvedValue({ offers: [unlabelled], errorCode: null, stale: false });
    const resolved = await findOtpCheckoutOffer("ng", items[0].id);
    expect(resolved.errorCode).toBeNull();
    expect(resolved.listing).toMatchObject({ app: "Verification number", priceNgn: 1058, purchasable: true });
  });

  it("shows Bitcall inventory for other countries without enabling unsupported checkout", () => {
    const beninOffer: OtpOffer = {
      supplier: "bitcall", ref: "private-benin-service", country: "bj", app: "WhatsApp",
      costNgn: 250, stock: 6,
    };
    const items = bitcallOtpItemsForCountry([beninOffer], "bj", "Benin");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: "WhatsApp", category: "verification", source: "live", stock: 6,
      price: null, action: null, detail: "Benin · single-use verification",
    });
    expect(items[0].description).toContain("purchasing is locked for this country");
  });

  it("re-resolves an opaque offer ID from the live listing before checkout", async () => {
    const id = otpOfferPublicId("ng", "private-service-id-1", "WhatsApp");
    const result = await findOtpCheckoutOffer("ng", id, { refresh: true });
    expect(state.read).toHaveBeenCalledWith("bitcall", "ng", "Nigeria", undefined, true);
    expect(result).toMatchObject({
      errorCode: null,
      listing: { id, app: "WhatsApp", countryCode: "ng", priceNgn: 1058, purchasable: true },
    });
    expect(JSON.stringify(result)).not.toContain("private-service-id");
    expect(JSON.stringify(result)).not.toContain("costNgn");
  });

  it("does not make an unpriced, out-of-stock or unprofitable pool purchasable", async () => {
    state.read.mockResolvedValue({
      offers: [
        { ...offers[0], ref: "no-cost", costNgn: null },
        { ...offers[0], ref: "sold-out", stock: 0 },
        { ...offers[0], ref: "loss-making", costNgn: 2000 },
      ],
      errorCode: null,
    });
    for (const ref of ["no-cost", "sold-out", "loss-making"]) {
      const result = await findOtpCheckoutOffer("ng", otpOfferPublicId("ng", ref, "WhatsApp"));
      expect(result.listing?.purchasable).toBe(false);
    }
  });

  it("rejects an offer ID that is absent from the current listing", async () => {
    const result = await findOtpCheckoutOffer("ng", "otp-000000000000000000000000");
    expect(result).toEqual({ listing: null, errorCode: null });
  });
});
