import { beforeEach, describe, expect, it, vi } from "vitest";

const fleexa = vi.hoisted(() => ({
  configured: vi.fn(() => true),
  listSms: vi.fn(),
}));

const bitcall = vi.hoisted(() => ({
  configured: vi.fn(() => false),
  listCountryEntries: vi.fn(),
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
  listBitcallOtpCountryEntries: bitcall.listCountryEntries,
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
    bitcall.listCountryEntries.mockResolvedValue([
      { countryCode: "NG", name: "Nigeria", pools: [{ serviceId: "svc-1", price: 500, currency: "NGN", availableCount: 7 }] },
      { countryCode: "US_1", name: "United States (Virtual)", pools: [] },
    ]);
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

  it("requests only the published code matching the selected country", async () => {
    bitcall.configured.mockReturnValue(true);
    bitcall.listServices.mockResolvedValue([{
      name: "WhatsApp",
      slug: "whatsapp",
      countryCode: null,
      offers: [{ serviceId: "us-whatsapp-pool", price: 500, currency: "NGN", availableCount: 9, successRate: 87 }],
    }]);

    const { readOtpOffersForSupplier, clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");
    clearOtpCatalogueCache();
    const read = await readOtpOffersForSupplier("bitcall", "us", "United States", undefined, true);

    expect(bitcall.listCountryEntries).toHaveBeenCalledOnce();
    expect(bitcall.listServices).toHaveBeenCalledExactlyOnceWith({ countryCode: "US_1" }, { signal: expect.any(AbortSignal) });
    expect(read.errorCode).toBeNull();
    expect(read.offers).toMatchObject([{ supplier: "bitcall", ref: "us-whatsapp-pool", country: "us", app: "WhatsApp", stock: 9 }]);
  });

  it("quarantines a conflicting country row while retaining unambiguous offers as partial", async () => {
    bitcall.configured.mockReturnValue(true);
    bitcall.listCountryEntries.mockResolvedValue([
      { countryCode: "US_1", name: "United States" },
      { countryCode: "US_2", name: "France" },
    ]);
    bitcall.listServices.mockResolvedValue([{
      name: "WhatsApp", countryCode: null,
      offers: [{ serviceId: "safe", price: 500, currency: "NGN", availableCount: 9 }],
    }]);
    const { readOtpOffersForSupplier, clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");
    clearOtpCatalogueCache();
    const read = await readOtpOffersForSupplier("bitcall", "us", "United States");
    expect(read).toMatchObject({ partial: true, degraded: "outage", errorCode: "SERVICE_RESPONSE_INVALID", offers: [{ ref: "safe" }] });
    expect(bitcall.listServices).toHaveBeenCalledExactlyOnceWith({ countryCode: "US_1" }, { signal: expect.any(AbortSignal) });
    // Partial reads must not enter the healthy cache.
    await readOtpOffersForSupplier("bitcall", "us", "United States");
    expect(bitcall.listServices).toHaveBeenCalledTimes(2);
  });

  it("does not invent a provider code when the selected country is absent", async () => {
    bitcall.configured.mockReturnValue(true);
    const { readOtpOffersForSupplier, clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");
    clearOtpCatalogueCache();
    const read = await readOtpOffersForSupplier("bitcall", "de", "Germany", undefined, true);

    expect(bitcall.listServices).not.toHaveBeenCalled();
    expect(read).toMatchObject({ offers: [], errorCode: null });
  });

  it("accepts a slower Bitcall OTP catalogue read instead of dropping the app verification list", async () => {
    vi.useFakeTimers();
    bitcall.configured.mockReturnValue(true);
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

  it("shares simultaneous ordinary reads without sharing a checkout refresh", async () => {
    bitcall.configured.mockReturnValue(true);
    let release!: (value: unknown[]) => void;
    const waiting = new Promise<unknown[]>((resolve) => { release = resolve; });
    bitcall.listServices.mockReturnValueOnce(waiting).mockResolvedValueOnce([]);
    const { readOtpOffersForSupplier, clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");
    clearOtpCatalogueCache();

    const first = readOtpOffersForSupplier("bitcall", "us", "United States");
    const second = readOtpOffersForSupplier("bitcall", "us", "United States");
    await vi.waitFor(() => expect(bitcall.listServices).toHaveBeenCalledTimes(1));
    const refresh = readOtpOffersForSupplier("bitcall", "us", "United States", undefined, true);
    await vi.waitFor(() => expect(bitcall.listServices).toHaveBeenCalledTimes(2));
    await refresh;
    release([{ name: "Old", countryCode: "US_1", offers: [{ serviceId: "old", price: 5, currency: "NGN", availableCount: 1 }] }]);
    await Promise.all([first, second]);

    // The older in-flight browse must not replace the fresher empty checkout read.
    const cached = await readOtpOffersForSupplier("bitcall", "us", "United States");
    expect(cached.offers).toEqual([]);
    expect(bitcall.listServices).toHaveBeenCalledTimes(2);
  });

  it("aborts an unfinished service read at its deadline", async () => {
    vi.useFakeTimers();
    try {
      bitcall.configured.mockReturnValue(true);
      let signal!: AbortSignal;
      bitcall.listServices.mockImplementation((_filter, options: { signal: AbortSignal }) => {
        signal = options.signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        });
      });
      const { readOtpOffersForSupplier, clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");
      clearOtpCatalogueCache();
      const pending = readOtpOffersForSupplier("bitcall", "us", "United States", 50, true);
      await vi.advanceTimersByTimeAsync(50);
      const read = await pending;
      expect(read.offers).toEqual([]);
      expect(read.errorCode).not.toBeNull();
      expect(signal.aborted).toBe(true);
      expect(bitcall.listServices).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not start a service request after timing out on the shared country list", async () => {
    vi.useFakeTimers();
    try {
      bitcall.configured.mockReturnValue(true);
      let release!: (value: unknown[]) => void;
      bitcall.listCountryEntries.mockReturnValue(new Promise<unknown[]>((resolve) => { release = resolve; }));
      const { readOtpOffersForSupplier, clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");
      clearOtpCatalogueCache();
      const pending = readOtpOffersForSupplier("bitcall", "us", "United States", 50, true);
      await vi.advanceTimersByTimeAsync(50);
      expect((await pending).errorCode).not.toBeNull();
      release([{ countryCode: "US_1", name: "United States", pools: [] }]);
      await vi.advanceTimersByTimeAsync(0);
      expect(bitcall.listServices).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the last good OTP offers visible when the provider briefly fails", async () => {
    bitcall.configured.mockReturnValue(true);
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
    bitcall.listServices.mockImplementation(async (filter: { countryCode: string }) => filter.countryCode === "NG" ? [
      {
        name: "WhatsApp",
        slug: "ng-whatsapp",
        countryCode: "NG",
        offers: [{ serviceId: "svc-1", price: 500, currency: "NGN", availableCount: 7, successRate: 87 }],
      },
    ] : []);

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
