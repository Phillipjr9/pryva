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

// Rates, not FX: the catalogue test is about which offers survive a failed
// read, and a speculative rate warm-up must not turn into a network call here.
vi.mock("@/lib/payments/exchange-rate", () => ({
  getUsdToNgnRate: vi.fn(async () => ({ rate: 1600, source: "override", fetchedAt: new Date().toISOString() })),
  getFreshNgnRate: vi.fn(async () => ({ rate: 1740, source: "live", fetchedAt: new Date().toISOString() })),
}));

vi.mock("@/lib/providers/bitcall", () => ({
  isBitcallConfigured: bitcall.configured,
  BitcallError: class BitcallError extends Error {},
  listBitcallOtpCountries: bitcall.listCountries,
  listBitcallOtpServices: bitcall.listServices,
  listBitcallOtpCountryEntries: bitcall.listCountryEntries,
  otpServiceLabelFromId: (id: string) => id.split("-").slice(2).join("-") || null,
  otpCountrySegmentFromId: (id: string) => id.split("-").filter(Boolean)[1] ?? null,
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
    // This destination states its own offers, so those are what is listed. The
    // service read still runs alongside the country read — it is started before
    // anyone knows which path is needed, and the read it warms is shared — but it
    // is never given a country filter: a filtered answer names no country on its
    // rows, so it could not show that the filter had been applied.
    expect(read.offers).toHaveLength(1);
    for (const call of bitcall.listServices.mock.calls) expect(call[0]).toEqual({});
  });

  it("walks the shared feeds once for many destinations, and never for a checkout", async () => {
    bitcall.configured.mockReturnValue(true);
    bitcall.listCountryEntries.mockResolvedValue([
      {
        countryCode: "NG_1", name: "Nigeria", serviceCount: 1, availableCount: 4,
        startingPrice: 500, currency: "NGN",
        pools: [{ serviceId: "CHARLIE-NG_1-whatsapp", price: 500, currency: "NGN", availableCount: 4, successRate: 87 }],
      },
      {
        countryCode: "US_1", name: "United States (Virtual)", serviceCount: 1, availableCount: 2,
        startingPrice: 900, currency: "NGN",
        pools: [{ serviceId: "CHARLIE-US_1-gmail", price: 900, currency: "NGN", availableCount: 2, successRate: 80 }],
      },
    ]);

    const { readOtpOffersForSupplier, clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");
    clearOtpCatalogueCache();

    expect((await readOtpOffersForSupplier("bitcall", "ng", "Nigeria")).offers).toHaveLength(1);
    expect((await readOtpOffersForSupplier("bitcall", "us", "United States")).offers).toHaveLength(1);
    // Both destinations were answered from one read of the same feed. Walking it
    // per destination is what made the shop slow rather than the gateway.
    expect(bitcall.listCountryEntries).toHaveBeenCalledTimes(1);

    // A checkout is the one reader that must not share an older read: it is about
    // to spend, so it re-reads the feed rather than trusting the cache.
    await readOtpOffersForSupplier("bitcall", "ng", "Nigeria", undefined, true);
    expect(bitcall.listCountryEntries).toHaveBeenCalledTimes(2);
  });

  it("starts the service catalogue read without waiting for the country read", async () => {
    bitcall.configured.mockReturnValue(true);
    let release!: (value: unknown) => void;
    bitcall.listCountryEntries.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    bitcall.listServices.mockResolvedValue([]);

    const { readOtpOffersForSupplier, clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");
    clearOtpCatalogueCache();
    const read = readOtpOffersForSupplier("bitcall", "ng", "Nigeria");

    // The country read has not answered yet; the service read is already out.
    expect(bitcall.listServices).toHaveBeenCalledTimes(1);
    release([{ countryCode: "NG_1", name: "Nigeria", serviceCount: 0, availableCount: 0, startingPrice: null, currency: null, pools: [] }]);
    await read;
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

  it("attributes offers by their published id when a country entry carries no pools", async () => {
    // The fallback used to filter service rows on a `countryCode` they never
    // carry, so a destination whose country entry omits `pools[]` read as empty —
    // and said nothing about it. Attribution now comes from the destination
    // segment of the offer's own id, and only for a code this destination itself
    // published, so a Ghanaian offer cannot surface under Nigeria.
    bitcall.configured.mockReturnValue(true);
    bitcall.listCountryEntries.mockResolvedValue([
      { countryCode: "NG_1", name: "Nigeria (Virtual)", serviceCount: 3, availableCount: 0, startingPrice: null, currency: null, pools: [] },
    ]);
    bitcall.listServices.mockResolvedValue([
      { name: "WhatsApp", slug: "whatsapp", offers: [{ serviceId: "BRAVO-NG_1-whatsapp", price: 800, currency: "NGN", availableCount: 4, successRate: 91 }] },
      { name: "Telegram", slug: "telegram", offers: [{ serviceId: "BRAVO-US_1-telegram", price: 900, currency: "NGN", availableCount: 4, successRate: 91 }] },
      { name: "Gmail", slug: "gmail", offers: [{ serviceId: "BRAVO-GH_1-gmail", price: 700, currency: "NGN", availableCount: 4, successRate: 91 }] },
    ]);

    const { readOtpOffersForSupplier, clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");
    clearOtpCatalogueCache();
    const read = await readOtpOffersForSupplier("bitcall", "ng", "Nigeria");

    expect(read.offers.map((offer) => offer.ref)).toEqual(["BRAVO-NG_1-whatsapp"]);
    expect(read.offers[0]).toMatchObject({ app: "WhatsApp", stock: 4, costNgn: 800 });
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

  describe("a slow or failed catalogue read", () => {
    const NG_ENTRY = {
      countryCode: "NG",
      name: "Nigeria",
      serviceCount: 1,
      availableCount: 4,
      startingPrice: 800,
      currency: "NGN",
      pools: [{ serviceId: "BRAVO-NG_1-whatsapp", price: 800, currency: "NGN", availableCount: 4, successRate: 91 }],
    };

    it("serves the last good read instead of emptying the shop", async () => {
      bitcall.configured.mockReturnValue(true);
      bitcall.listCountryEntries.mockResolvedValue([NG_ENTRY]);

      const { readOtpOffersForSupplier, clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");
      clearOtpCatalogueCache();
      const first = await readOtpOffersForSupplier("bitcall", "ng", "Nigeria");
      expect(first.stale).toBe(false);
      expect(first.offers).toHaveLength(1);

      // Past the TTL, so the next browse read really does go back to the feed —
      // and the feed is now the failure from the production log.
      vi.useFakeTimers();
      try {
        vi.setSystemTime(Date.now() + 5 * 60_000);
        bitcall.listCountryEntries.mockRejectedValue(new Error("catalogue read exceeded 4000ms"));
        const second = await readOtpOffersForSupplier("bitcall", "ng", "Nigeria");

        expect(second.stale).toBe(true);
        expect(second.errorCode).toBeNull();
        expect(second.offers).toEqual(first.offers);
        // What the catalogue route turns into "may be incomplete or out of date".
        expect(second).toMatchObject({ partial: true, degraded: "outage" });
        expect(first).toMatchObject({ partial: false, degraded: null });
      } finally {
        vi.useRealTimers();
      }
    });

    it("waits for a slow feed instead of declaring the country empty", async () => {
      // Being late is not evidence about the catalogue. The read used to be
      // abandoned after 4 s (checkout) or 8 s (browsing) — both shorter than the
      // gateway's own 20 s timeout — so a slow but working feed reported
      // "nothing on offer" and the shop went empty for a country that had stock.
      bitcall.configured.mockReturnValue(true);
      let answer: () => void = () => {};
      bitcall.listCountryEntries.mockReturnValue(new Promise((resolve) => {
        answer = () => resolve([{
          countryCode: "NG",
          name: "Nigeria",
          serviceCount: 1,
          availableCount: 4,
          startingPrice: 800,
          currency: "NGN",
          pools: [{ serviceId: "BRAVO-NG_1-whatsapp", price: 800, currency: "NGN", availableCount: 4, successRate: 91 }],
        }]);
      }));

      const { readOtpOffersForSupplier, clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");
      clearOtpCatalogueCache();
      const reading = readOtpOffersForSupplier("bitcall", "ng", "Nigeria");

      vi.useFakeTimers();
      try {
        await vi.advanceTimersByTimeAsync(30_000);
        answer();
        const read = await reading;

        expect(read.errorCode).toBeNull();
        expect(read.stale).toBe(false);
        expect(read.offers).toMatchObject([{ ref: "BRAVO-NG_1-whatsapp", stock: 4 }]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("refuses an old read when the caller asked for a live one", async () => {
      bitcall.configured.mockReturnValue(true);
      bitcall.listCountryEntries.mockResolvedValue([NG_ENTRY]);

      const { readOtpOffersForSupplier, clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");
      clearOtpCatalogueCache();
      await readOtpOffersForSupplier("bitcall", "ng", "Nigeria");

      vi.useFakeTimers();
      try {
        vi.setSystemTime(Date.now() + 5 * 60_000);
        bitcall.listCountryEntries.mockRejectedValue(new Error("catalogue read exceeded 4000ms"));
        // A checkout revalidates with `refresh` because it is about to spend: a
        // stale answer must never stand in for a live one there.
        const live = await readOtpOffersForSupplier("bitcall", "ng", "Nigeria", undefined, true);

        expect(live.stale).toBe(false);
        expect(live.offers).toEqual([]);
        expect(live.errorCode).not.toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("honours a deadline only when the caller passes one", async () => {
      bitcall.configured.mockReturnValue(true);
      bitcall.listCountryEntries.mockReturnValue(new Promise(() => {}));

      const { readOtpOffersForSupplier, clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");
      clearOtpCatalogueCache();

      vi.useFakeTimers();
      try {
        const bounded = readOtpOffersForSupplier("bitcall", "ng", "Nigeria", 2_000);
        await vi.advanceTimersByTimeAsync(2_001);
        const read = await bounded;

        expect(read.offers).toEqual([]);
        expect(read.errorCode).toBe("UNKNOWN_ERROR");
        expect(read).toMatchObject({ stale: false, partial: false, degraded: "outage" });

        // The same feed, with no deadline asked for: still waiting a minute later.
        let settled = false;
        void readOtpOffersForSupplier("bitcall", "ng", "Nigeria").then(() => { settled = true; });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(settled).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("says an unfunded supplier is unfunded, not down", async () => {
      bitcall.configured.mockReturnValue(true);

      const { readOtpOffersForSupplier, clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");
      const { BitcallError } = await import("@/lib/providers/bitcall");
      clearOtpCatalogueCache();
      // The class is mocked above without a constructor, so the code is set by
      // hand. The reader only ever looks at `code`, never at the message.
      const refusal = Object.assign(new BitcallError("Gateway request failed", 402, "INSUFFICIENT_BALANCE"), { code: "INSUFFICIENT_BALANCE" });
      bitcall.listCountryEntries.mockRejectedValue(refusal);

      const read = await readOtpOffersForSupplier("bitcall", "ng", "Nigeria");

      expect(read).toMatchObject({ offers: [], errorCode: "INSUFFICIENT_BALANCE", degraded: "funding", stale: false });
    });

    it("stops serving a read once the feed has been down long enough", async () => {
      bitcall.configured.mockReturnValue(true);
      bitcall.listCountryEntries.mockResolvedValue([NG_ENTRY]);

      const { readOtpOffersForSupplier, clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");
      clearOtpCatalogueCache();
      await readOtpOffersForSupplier("bitcall", "ng", "Nigeria");

      vi.useFakeTimers();
      try {
        vi.setSystemTime(Date.now() + 31 * 60_000);
        bitcall.listCountryEntries.mockRejectedValue(new Error("catalogue read exceeded 4000ms"));
        const later = await readOtpOffersForSupplier("bitcall", "ng", "Nigeria");

        expect(later.stale).toBe(false);
        expect(later.offers).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
