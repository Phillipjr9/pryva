import { beforeEach, describe, expect, it, vi } from "vitest";

const fleexa = vi.hoisted(() => ({
  configured: vi.fn(() => true),
  listSms: vi.fn(),
}));

const bitcall = vi.hoisted(() => ({
  configured: vi.fn(() => false),
  listServices: vi.fn(),
}));

vi.mock("@/lib/providers/fleexa", () => ({
  isFleexaConfigured: fleexa.configured,
  listFleexaSmsServices: fleexa.listSms,
  FleexaError: class FleexaError extends Error {},
}));

vi.mock("@/lib/providers/bitcall", () => ({
  isBitcallConfigured: bitcall.configured,
  listBitcallOtpServices: bitcall.listServices,
  isAmbiguousBitcallOutcome: vi.fn(() => false),
  buyBitcallOtpActivation: vi.fn(),
}));

describe("otp stock aggregation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    fleexa.configured.mockReturnValue(true);
    bitcall.configured.mockReturnValue(false);
    fleexa.listSms.mockResolvedValue([
      { id: "a", name: "WhatsApp", country: "NG", priceNgn: 1200, stock: 7 },
      { id: "b", name: "WhatsApp", country: "NG", priceNgn: 1100, stock: 3 },
      { id: "c", name: "Telegram", country: "NG", priceNgn: 1400, stock: 2 },
    ]);
  });

  it("keeps all available stock for a country instead of collapsing repeated app pools", async () => {
    const { otpOffersFor, clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");
    clearOtpCatalogueCache();

    const offers = await otpOffersFor("ng", "Nigeria");

    expect(offers.map((offer) => ({ app: offer.app, stock: offer.stock }))).toEqual([
      { app: "WhatsApp", stock: 10 },
      { app: "Telegram", stock: 2 },
    ]);
  });
});
