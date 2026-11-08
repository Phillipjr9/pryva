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
  it("deduplicates app services, chooses a sellable pool and hides provider references and costs", () => {
    const items = bitcallOtpItemsForCountry(offers, "ng", "Nigeria");
    expect(items.map((item) => item.name)).toEqual(["Signal", "Unknown app", "WhatsApp"]);
    const whatsapp = items.find((item) => item.name === "WhatsApp")!;
    expect(whatsapp).toMatchObject({
      source: "live",
      category: "verification",
      stock: 3,
      price: 1340,
      action: { label: "Choose service", href: expect.stringContaining("?country=ng") },
    });
    const signal = items.find((item) => item.name === "Signal")!;
    expect(signal).toMatchObject({ price: null, stock: 0, action: null });
    const payload = JSON.stringify(items);
    expect(payload).not.toContain("private-service-id");
    expect(payload).not.toContain("costNgn");
    expect(payload).not.toContain("250");
  });

  it("re-resolves an opaque offer ID from the live listing before checkout", async () => {
    const id = otpOfferPublicId("ng", "private-service-id-1", "WhatsApp");
    const result = await findOtpCheckoutOffer("ng", id, { refresh: true });
    expect(state.read).toHaveBeenCalledWith("bitcall", "ng", "Nigeria", undefined, true);
    expect(result).toMatchObject({
      errorCode: null,
      listing: { id, app: "WhatsApp", countryCode: "ng", priceNgn: 1340, purchasable: true },
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
