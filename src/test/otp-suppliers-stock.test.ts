import { beforeEach, describe, expect, it, vi } from "vitest";

const fleexa = vi.hoisted(() => ({
  configured: vi.fn(() => true),
  listSms: vi.fn(),
}));

const bitcall = vi.hoisted(() => ({
  configured: vi.fn(() => false),
  listCountries: vi.fn(),
  listServices: vi.fn(),
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
  BitcallError: class BitcallError extends Error {},
  listBitcallOtpCountries: bitcall.listCountries,
  listBitcallOtpCountryEntries: async () => [{ countryCode: "NG", name: "Nigeria", pools: [{ serviceId: "svc-1", price: 500, currency: "NGN", availableCount: 7 }] }],
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
    bitcall.listCountries.mockResolvedValue([]);
    bitcall.listServices.mockResolvedValue([]);
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

  it("filters the unfiltered feed against published country labels", async () => {
    bitcall.configured.mockReturnValue(true);
    bitcall.listCountries.mockResolvedValue(["NG", "US_1"]);
    bitcall.listServices.mockImplementation(async () => [{
      name: "WhatsApp",
      slug: "us-whatsapp",
      countryCode: "US_1",
      offers: [{ serviceId: "us-whatsapp-pool", price: 500, currency: "NGN", availableCount: 9, successRate: 87 }],
    }]);

    const { readOtpOffersForSupplier, clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");
    clearOtpCatalogueCache();
    const read = await readOtpOffersForSupplier("bitcall", "us", "United States", undefined, true);

    expect(bitcall.listServices).toHaveBeenCalledWith({});
    expect(read.errorCode).toBeNull();
    expect(read.offers).toMatchObject([{ supplier: "bitcall", ref: "us-whatsapp-pool", country: "us", app: "WhatsApp", stock: 9 }]);
  });

  it("uses the authoritative unfiltered catalogue without a separate country lookup", async () => {
    bitcall.configured.mockReturnValue(true);
    bitcall.listCountries.mockResolvedValue(["US_1"]);
    const service = {
      name: "WhatsApp", slug: "us-whatsapp", countryCode: "US_1",
      offers: [{ serviceId: "us-whatsapp-pool", price: 500, currency: "NGN", availableCount: 9, successRate: 87 }],
    };
    bitcall.listServices.mockResolvedValue([service]);

    const { readOtpOffersForSupplier, clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");
    clearOtpCatalogueCache();
    const read = await readOtpOffersForSupplier("bitcall", "us", "United States", undefined, true);

    expect(bitcall.listServices).toHaveBeenCalledExactlyOnceWith({});
    expect(read.offers).toMatchObject([{ ref: "us-whatsapp-pool", country: "us", app: "WhatsApp", stock: 9 }]);
  });

  it("accepts a slower Bitcall OTP catalogue read instead of dropping the app verification list", async () => {
    vi.useFakeTimers();
    bitcall.configured.mockReturnValue(true);
    bitcall.listCountries.mockResolvedValue(["US_1"]);
    bitcall.listServices.mockImplementation(async (filter?: { countryCode?: string }) => {
      if (filter) {
        await new Promise((resolve) => setTimeout(resolve, 6_000));
        return [{
          name: "WhatsApp",
          slug: "us-whatsapp",
          countryCode: "US_1",
          offers: [{ serviceId: "us-whatsapp-pool", price: 500, currency: "NGN", availableCount: 9, successRate: 87 }],
        }];
      }
      return [];
    });

    const { readOtpOffersForSupplier, clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");
    clearOtpCatalogueCache();

    const promise = readOtpOffersForSupplier("bitcall", "us", "United States", undefined, true);
    await vi.advanceTimersByTimeAsync(6_000);
    const read = await promise;

    expect(read.errorCode).toBeNull();
    expect(read.offers).toMatchObject([{ ref: "us-whatsapp-pool", country: "us", app: "WhatsApp", stock: 9 }]);
    vi.useRealTimers();
  });

  it("keeps the last good OTP offers visible when the provider briefly fails", async () => {
    bitcall.configured.mockReturnValue(true);
    bitcall.listCountries.mockResolvedValue(["US_1"]);
    bitcall.listServices.mockResolvedValueOnce([
      {
        name: "WhatsApp",
        slug: "us-whatsapp",
        countryCode: "US_1",
        offers: [{ serviceId: "us-whatsapp-pool", price: 500, currency: "NGN", availableCount: 9, successRate: 87 }],
      },
    ]);

    const { readOtpOffersForSupplier, clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");
    clearOtpCatalogueCache();

    const first = await readOtpOffersForSupplier("bitcall", "us", "United States", undefined, true);
    expect(first.offers).toMatchObject([{ app: "WhatsApp", stock: 9 }]);

    bitcall.listServices.mockRejectedValueOnce(new Error("temporary outage"));
    const second = await readOtpOffersForSupplier("bitcall", "us", "United States", undefined, true);

    expect(second.offers).toMatchObject([{ app: "WhatsApp", stock: 9 }]);
    expect(second.errorCode).toBe("UNKNOWN_ERROR");
    expect(second.partial).toBe(true);
  });

  it("keeps Bitcall stock visible when the API returns uppercase ISO codes", async () => {
    bitcall.configured.mockReturnValue(true);
    bitcall.listServices.mockResolvedValue([
      {
        name: "WhatsApp",
        slug: "ng-whatsapp",
        countryCode: "NG",
        offers: [{ serviceId: "svc-1", price: 0.5, currency: "USD", availableCount: 7, successRate: 87 }],
      },
    ]);

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
