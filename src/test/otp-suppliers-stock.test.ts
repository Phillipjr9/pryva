import { beforeEach, describe, expect, it, vi } from "vitest";

const fleexa = vi.hoisted(() => ({
  configured: vi.fn(() => true),
  listSms: vi.fn(),
}));

const bitcall = vi.hoisted(() => ({
  configured: vi.fn(() => false),
  listCountries: vi.fn(),
  listServices: vi.fn(),
  listCountryEntries: vi.fn(),
}));

const snapshot = vi.hoisted(() => ({
  readSupplierSnapshot: vi.fn(async () => ({ sms: [], email: [], rentals: [] })),
}));

vi.mock("@/lib/providers/fleexa", () => ({
  isFleexaConfigured: fleexa.configured,
  listFleexaSmsServices: fleexa.listSms,
  FleexaError: class FleexaError extends Error {},
}));

vi.mock("@/lib/services/numbers/fleexa-catalog", () => ({
  readSupplierSnapshot: snapshot.readSupplierSnapshot,
}));

vi.mock("@/lib/providers/bitcall", () => ({
  isBitcallConfigured: bitcall.configured,
  listBitcallOtpCountries: bitcall.listCountries,
  listBitcallOtpServices: bitcall.listServices,
  listBitcallOtpCountryEntries: bitcall.listCountryEntries,
  otpServiceLabelFromId: (id: string) => id.split("-").slice(2).join("-") || null,
  otpCountrySegmentFromId: (id: string) => id.split("-")[1] ?? null,
  isAmbiguousBitcallOutcome: vi.fn(() => false),
  buyBitcallOtpActivation: vi.fn(),
}));

describe("otp stock aggregation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    fleexa.configured.mockReturnValue(true);
    bitcall.configured.mockReturnValue(false);
    bitcall.listCountries.mockResolvedValue([]);
    bitcall.listServices.mockResolvedValue([]);
    bitcall.listCountryEntries.mockResolvedValue([]);
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

  it("attributes each offer to the country the country catalogue publishes it under", async () => {
    bitcall.configured.mockReturnValue(true);
    // The service catalogue names no country at all, which is why a listing built
    // from it was empty for every destination while the key still worked. The
    // country catalogue is where a destination and its pooled offers are stated.
    bitcall.listCountryEntries.mockResolvedValue([{
      countryCode: "US_1",
      name: "United States (Virtual)",
      serviceCount: 1270,
      availableCount: 9,
      startingPrice: 0.6,
      currency: "EUR",
      pools: [{ serviceId: "CHARLIE-US-whatsapp", price: 500, currency: "NGN", availableCount: 9, successRate: 87 }],
    }]);

    const { readOtpOffersForSupplier, clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");
    clearOtpCatalogueCache();
    const read = await readOtpOffersForSupplier("bitcall", "us", "United States", undefined, true);

    expect(read.errorCode).toBeNull();
    expect(read.offers).toMatchObject([
      { supplier: "bitcall", ref: "CHARLIE-US-whatsapp", country: "us", app: "WhatsApp", stock: 9 },
    ]);
    // No country filter is sent, because the endpoint accepts none.
    expect(bitcall.listServices).not.toHaveBeenCalled();
  });

  it("attributes offers by their published id when a country entry carries no pools", async () => {
    bitcall.configured.mockReturnValue(true);
    // The field is documented but optional, so a destination can arrive without
    // its inline pools. The offer's own id names its destination; it is matched
    // only against the codes this catalogue published for the destination.
    bitcall.listCountryEntries.mockResolvedValue([
      { countryCode: "NG_1", name: "Nigeria", serviceCount: 1, availableCount: 0, startingPrice: null, currency: null, pools: [] },
      { countryCode: "US_1", name: "United States (Virtual)", serviceCount: 1, availableCount: 0, startingPrice: null, currency: null, pools: [] },
    ]);
    bitcall.listServices.mockResolvedValue([{
      name: "WhatsApp",
      slug: "whatsapp",
      countryCode: null,
      offers: [
        { serviceId: "BRAVO-NG_1-whatsapp", price: 900, currency: "NGN", availableCount: 4, successRate: 90 },
        { serviceId: "BRAVO-US_1-whatsapp", price: 900, currency: "NGN", availableCount: 4, successRate: 90 },
        { serviceId: "BRAVO-GH_1-whatsapp", price: 900, currency: "NGN", availableCount: 4, successRate: 90 },
      ],
    }]);

    const { readOtpOffersForSupplier, clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");
    clearOtpCatalogueCache();
    const read = await readOtpOffersForSupplier("bitcall", "ng", "Nigeria", undefined, true);

    // Ghana's code is not one this destination published, so it cannot be
    // attributed to Nigeria even though the service name matches.
    expect(read.offers.map((offer) => offer.ref)).toEqual(["BRAVO-NG_1-whatsapp"]);
  });

  it("falls back to the service rows only when the country catalogue carries no pools", async () => {
    bitcall.configured.mockReturnValue(true);
    bitcall.listCountryEntries.mockResolvedValue([{
      countryCode: "US_1",
      name: "United States (Virtual)",
      serviceCount: 1,
      availableCount: 0,
      startingPrice: null,
      currency: null,
      pools: [],
    }]);
    bitcall.listServices.mockResolvedValue([{
      name: "WhatsApp",
      slug: "us-whatsapp",
      countryCode: "US_1",
      offers: [{ serviceId: "us-whatsapp-pool", price: 500, currency: "NGN", availableCount: 9, successRate: 87 }],
    }]);

    const { readOtpOffersForSupplier, clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");
    clearOtpCatalogueCache();
    const read = await readOtpOffersForSupplier("bitcall", "us", "United States", undefined, true);

    expect(read.offers).toMatchObject([{ ref: "us-whatsapp-pool", country: "us", app: "WhatsApp", stock: 9 }]);
  });

  it("keeps Bitcall stock visible when the country catalogue reports uppercase ISO codes", async () => {
    bitcall.configured.mockReturnValue(true);
    // The country catalogue is what the stock lane reads: it is the only feed
    // that states which destination a pooled offer belongs to.
    bitcall.listCountryEntries.mockResolvedValue([{
      countryCode: "NG",
      name: "Nigeria",
      serviceCount: 1,
      availableCount: 7,
      startingPrice: 0.5,
      currency: "USD",
      pools: [{ serviceId: "svc-1", price: 0.5, currency: "USD", availableCount: 7, successRate: 87 }],
    }]);

    const { buildStockReport } = await import("@/lib/admin/stock-live");
    const { isFleexaConfigured } = await import("@/lib/providers/fleexa");
    const { isBitcallConfigured } = await import("@/lib/providers/bitcall");

    expect(isFleexaConfigured()).toBe(true);
    expect(isBitcallConfigured()).toBe(true);

    const report = await buildStockReport();
    const numbers = report.lanes.find((lane) => lane.lane === "numbers");

    expect(numbers?.lines.some((line) => line.id === "vn-ng" && line.state === "in-stock")).toBe(true);
  });
});
