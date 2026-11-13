import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/identity/auth", async (original) => {
  const actual = await original<typeof import("@/lib/identity/auth")>();
  return { ...actual, getCurrentUser: async () => ({ id: "catalogue-test-user" }) };
});
vi.mock("@/lib/platform/financial-environment", async (original) => {
  const actual = await original<typeof import("@/lib/platform/financial-environment")>();
  return { ...actual, financialActionsUnavailable: () => false };
});
vi.mock("@/lib/platform/rate-limit", async (original) => {
  const actual = await original<typeof import("@/lib/platform/rate-limit")>();
  return { ...actual, catalogRateLimiter: async () => ({ allowed: true }) };
});

import { GET } from "@/app/api/services/catalog/route";
import { findPlan } from "@/lib/services/catalog";
import { EXPLORER_COUNTRIES } from "@/lib/content/explorer-countries";
import { fulfillPlan, SUPPORTED_VIRTUAL_NUMBER_COUNTRIES } from "@/lib/services/fulfillment";
import { bitcallDeclaredCountryMatches, clearOtpCatalogueCache, otpOfferPublicId, readOtpOffersForSupplier } from "@/lib/services/numbers/otp-suppliers";

const PRIVATE_US = "private-offer-us";
const PRIVATE_NG = "private-offer-ng";
const countries = [
  { countryCode: "US_1", name: "United States (Virtual)" },
  { countryCode: "NG_234", name: "Nigeria" },
];

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}

function makeGateway(options: {
  detailCountry?: string | null;
  detailOtherCountry?: string;
  detailCountryName?: string;
  detailStock?: number | null;
  detailPrice?: number | null;
  detailServiceId?: string;
  detailStatus?: number;
  detailExtraPage?: boolean;
  missingCurrency?: boolean;
  conflictingPool?: boolean;
  conflictingPoolFields?: boolean;
  badCountries?: boolean;
  unreadableCountryRow?: boolean;
  contradictoryCountryName?: boolean;
  mixedCountryNames?: boolean;
  emptyCountries?: boolean;
  unreadableServices?: boolean;
  mixedUnreadableServices?: boolean;
  inconsistentCountryCount?: boolean;
  inconsistentServiceCount?: boolean;
  zeroCountWithService?: boolean;
  throttleServices?: boolean;
  activate?: boolean;
} = {}) {
  return vi.fn(async (input: URL, init: RequestInit) => {
    const url = new URL(String(input));
    if (init.method !== "GET") {
      if (options.activate && init.method === "POST" && url.pathname === "/v1/otp/activations") {
        return json({ data: { id: "fake-activation", phoneNumber: "+12025550123", status: "waiting", price: { amount: options.detailPrice ?? 100, currency: "NGN" } } });
      }
      throw new Error("A catalogue test must not place an activation");
    }
    if (url.pathname === "/v1/otp/countries") {
      if (options.badCountries) return json({ unexpected: true });
      if (options.inconsistentCountryCount) return json({ data: [], meta: { page: 1, total: 1, totalPages: 1, hasNext: false } });
      const entries = options.emptyCountries ? [] : options.unreadableCountryRow ? [{ name: "United States" }]
        : options.contradictoryCountryName ? [{ countryCode: "US_1", name: "France" }]
        : options.mixedCountryNames ? [...countries, { countryCode: "US_2", name: "France" }] : countries;
      return json({ data: entries, meta: { page: 1, totalPages: 1, hasNext: false } });
    }
    if (url.pathname === "/v1/otp/services") {
      if (options.throttleServices) return json({ error: { code: "RATE_LIMITED" } }, 429, { "Retry-After": "60" });
      if (options.inconsistentServiceCount) return json({ data: [], meta: { page: 1, total: 1, totalPages: 1, hasNext: false } });
      if (options.unreadableServices) return json({ data: [{ name: "WhatsApp", pools: [{ price: 100 }] }], meta: { page: 1, hasNext: false } });
      if (options.mixedUnreadableServices) return json({
        data: [{ name: "Empty", pools: [] }, { name: "Unreadable", pools: [{ price: 100 }] }],
        meta: { page: 1, hasNext: false },
      });
      const code = url.searchParams.get("country_code");
      // As documented, the unfiltered service row has pools from several
      // countries and neither the row nor its pools need a country property.
      const ids = code === "US_1" ? [PRIVATE_US] : code === "NG_234" ? [PRIVATE_NG] : [PRIVATE_US, PRIVATE_NG];
      return json({ data: [{
        name: "WhatsApp", slug: "whatsapp", pools: ids.map((serviceId) => ({
          serviceId, price: options.missingCurrency ? { amount: 100 } : { amount: 100, currency: "NGN" },
          availableCount: 7,
          ...(options.conflictingPool ? { countryCode: "NG_234" } : {}),
          ...(options.conflictingPoolFields ? { countryCode: "US_1", country: { countryCode: "NG_234" } } : {}),
        })),
      }], meta: { page: 1, ...(options.zeroCountWithService ? { total: 0 } : {}), totalPages: 1, hasNext: false } });
    }
    if (url.pathname.startsWith("/v1/otp/services/")) {
      if (options.detailStatus) return json({ error: "detail unavailable" }, options.detailStatus);
      return json({ data: [{
        serviceId: options.detailServiceId ?? PRIVATE_US, name: "WhatsApp", slug: "whatsapp",
        ...(options.detailCountry === null ? {} : { country: { countryCode: options.detailCountry ?? "US_1", name: options.detailCountryName ?? "United States (Virtual)" } }),
        ...(options.detailOtherCountry ? { countryCode: options.detailOtherCountry } : {}),
        price: options.detailPrice === null ? { amount: 100 } : { amount: options.detailPrice ?? 100, currency: "NGN" },
        availableCount: options.detailStock === null ? null : options.detailStock ?? 7,
      }], meta: { page: 1, totalPages: options.detailExtraPage ? 2 : 1, hasNext: !!options.detailExtraPage } });
    }
    throw new Error(`Unexpected read-only gateway path: ${url.pathname}`);
  });
}

beforeEach(() => {
  clearOtpCatalogueCache();
  vi.stubEnv("BITCALL_KEY_ID", "ak_test_flow");
  vi.stubEnv("BITCALL_API_SECRET", "ab".repeat(64));
  vi.stubEnv("VERCEL_ENV", "");
});
afterEach(() => { clearOtpCatalogueCache(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("documented OTP catalogue through the customer feed", () => {
  it("queries the provider-published country code and shows only that country's pools", async () => {
    const fetchMock = makeGateway();
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(new NextRequest("https://pryva.test/api/services/catalog?country=us&feed=verification"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ live: true, partial: false, items: [{ name: "WhatsApp", stock: 7 }] });
    expect(body.items).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain(PRIVATE_US);
    expect(JSON.stringify(body)).not.toContain(PRIVATE_NG);
    const urls = fetchMock.mock.calls.map(([input]) => new URL(String(input)));
    expect(urls.some((url) => url.pathname === "/v1/otp/countries")).toBe(true);
    const serviceRequest = urls.find((url) => url.pathname === "/v1/otp/services")!;
    expect(serviceRequest.searchParams.get("country_code")).toBe("US_1");
    expect(serviceRequest.searchParams.has("countryCode")).toBe(false);
    expect(fetchMock.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
  });

  it("uses each selectable country's published code without mixing its offers with another country", async () => {
    // Synthetic coverage exercises routing for the entire selector; it is not
    // a claim that the real supplier stocks every country.
    const published = EXPLORER_COUNTRIES.map(({ code, name }) => ({ countryCode: `${code.toUpperCase()}_1`, name }));
    const requested = new Set<string>();
    const fetchMock = vi.fn(async (input: URL, init: RequestInit) => {
      expect(init.method).toBe("GET");
      const url = new URL(String(input));
      if (url.pathname === "/v1/otp/countries") {
        const page = Number(url.searchParams.get("page"));
        const pageSize = Number(url.searchParams.get("pageSize"));
        const totalPages = Math.ceil(published.length / pageSize);
        return json({ data: published.slice((page - 1) * pageSize, page * pageSize),
          meta: { page, totalPages, hasNext: page < totalPages } });
      }
      expect(url.pathname).toBe("/v1/otp/services");
      const countryCode = url.searchParams.get("country_code");
      expect(countryCode).toBeTruthy();
      requested.add(countryCode!);
      const iso = countryCode!.slice(0, 2).toLowerCase();
      return json({ data: [{ name: `App ${iso}`, pools: [{
        serviceId: `opaque-${iso}`, price: { amount: 100, currency: "NGN" }, availableCount: 7,
      }] }], meta: { page: 1, totalPages: 1, hasNext: false } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const supported = new Set<string>(SUPPORTED_VIRTUAL_NUMBER_COUNTRIES);

    for (const country of EXPLORER_COUNTRIES) {
      const response = await GET(new NextRequest(`https://pryva.test/api/services/catalog?country=${country.code}&feed=verification`));
      const body = await response.json();
      expect(response.status, country.code).toBe(200);
      expect(body, country.code).toMatchObject({ live: true, partial: false, country: country.code,
        items: [{ name: `App ${country.code}`, stock: 7 }] });
      expect(body.items, country.code).toHaveLength(1);
      expect(Boolean(body.items[0].action), country.code).toBe(supported.has(country.code));
      expect(JSON.stringify(body)).not.toContain(`opaque-${country.code}`);
    }
    expect(requested).toEqual(new Set(published.map(({ countryCode }) => countryCode)));
  });

  it("keeps country-defining parentheses distinct when validating declared destinations", () => {
    expect(bitcallDeclaredCountryMatches("Congo (the Democratic Republic of the)", "cd", "Congo (the Democratic Republic of the)")).toBe(true);
    expect(bitcallDeclaredCountryMatches("Congo (the Democratic Republic of the)", "cg", "Congo")).toBe(false);
    expect(bitcallDeclaredCountryMatches("Virgin Islands (British)", "vg", "Virgin Islands (British)")).toBe(true);
    expect(bitcallDeclaredCountryMatches("Virgin Islands (British)", "vi", "Virgin Islands (U.S.)")).toBe(false);
    expect(bitcallDeclaredCountryMatches("United States (Virtual)", "us", "United States")).toBe(true);
  });

  it("fails the read rather than attaching a contradictory pool to the selected country", async () => {
    vi.stubGlobal("fetch", makeGateway({ conflictingPool: true }));
    const read = await readOtpOffersForSupplier("bitcall", "us", "United States", undefined, true);
    expect(read.offers).toEqual([]);
    expect(read.errorCode).toBe("SERVICE_RESPONSE_INVALID");
  });

  it("rejects conflicting explicit country fields even when one matches", async () => {
    vi.stubGlobal("fetch", makeGateway({ conflictingPoolFields: true }));
    const read = await readOtpOffersForSupplier("bitcall", "us", "United States", undefined, true);
    expect(read.offers).toEqual([]);
    expect(read.errorCode).toBe("SERVICE_RESPONSE_INVALID");
  });

  it("rejects a country directory entry whose code and name identify different countries", async () => {
    vi.stubGlobal("fetch", makeGateway({ contradictoryCountryName: true }));
    const read = await readOtpOffersForSupplier("bitcall", "us", "United States", undefined, true);
    expect(read.offers).toEqual([]);
    expect(read.errorCode).toBe("SERVICE_RESPONSE_INVALID");
  });

  it("shows safe results as partial while refusing checkout on conflicting country metadata", async () => {
    const fetchMock = makeGateway({ mixedCountryNames: true });
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(new NextRequest("https://pryva.test/api/services/catalog?country=us&feed=verification"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ partial: true, reason: "partial", items: [{ name: "WhatsApp", action: null, price: null }] });
    const attempt = vi.fn();
    await expect(fulfillPlan(findPlan("vn-us")!, {
      otpOfferId: otpOfferPublicId("us", PRIVATE_US, "WhatsApp"), onOtpAttempt: attempt, onOtpAccepted: vi.fn(),
    })).rejects.toMatchObject({ code: "SERVICE_RESPONSE_INVALID" });
    expect(attempt).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
    expect(fetchMock.mock.calls.every(([input]) => new URL(String(input)).searchParams.get("country_code") !== "US_2")).toBe(true);
  });

  it("distinguishes an unreadable country response from an empty catalogue", async () => {
    vi.stubGlobal("fetch", makeGateway({ badCountries: true }));
    const response = await GET(new NextRequest("https://pryva.test/api/services/catalog?country=us&feed=verification"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ reason: "unavailable" });
  });

  it.each([
    ["country rows without codes", { unreadableCountryRow: true }],
    ["service rows without offer references", { unreadableServices: true }],
    ["empty rows mixed with unreadable services", { mixedUnreadableServices: true }],
  ])("does not turn %s into an empty result", async (_case, options) => {
    vi.stubGlobal("fetch", makeGateway(options));
    const response = await GET(new NextRequest("https://pryva.test/api/services/catalog?country=us&feed=verification"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ reason: "unavailable" });
  });

  it.each([
    ["an empty country directory with a positive total", { inconsistentCountryCount: true }],
    ["an empty service page with a positive total", { inconsistentServiceCount: true }],
    ["a service page with rows but a zero total", { zeroCountWithService: true }],
  ])("treats %s as an unavailable catalogue, not a complete result", async (_case, options) => {
    vi.stubGlobal("fetch", makeGateway(options));
    const response = await GET(new NextRequest("https://pryva.test/api/services/catalog?country=us&feed=verification"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ reason: "unavailable" });
  });

  it("reports a genuine empty result when the selected country is not published", async () => {
    const fetchMock = makeGateway({ emptyCountries: true });
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(new NextRequest("https://pryva.test/api/services/catalog?country=us&feed=verification"));
    expect(await response.json()).toMatchObject({ live: true, partial: false, items: [] });
    expect(fetchMock.mock.calls.some(([input]) => new URL(String(input)).pathname === "/v1/otp/services")).toBe(false);
  });

  it("never guesses USD when a Bitcall offer omits its currency", async () => {
    vi.stubGlobal("fetch", makeGateway({ missingCurrency: true }));
    const read = await readOtpOffersForSupplier("bitcall", "us", "United States", undefined, true);
    expect(read.offers).toMatchObject([{ costNgn: null, stock: 7 }]);
  });

  it("preserves a supplier throttle and does not immediately send another walk", async () => {
    const fetchMock = makeGateway({ throttleServices: true });
    vi.stubGlobal("fetch", fetchMock);
    const request = () => new NextRequest("https://pryva.test/api/services/catalog?country=us&feed=verification");
    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThanOrEqual(59);
    expect(await response.json()).toMatchObject({ reason: "throttled" });
    const calls = fetchMock.mock.calls.length;

    const second = await GET(request());
    expect(second.status).toBe(429);
    expect(Number(second.headers.get("retry-after"))).toBeGreaterThanOrEqual(59);
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  it("keeps cached listings explicitly partial with their original check time after throttling", async () => {
    vi.stubGlobal("fetch", makeGateway());
    const first = await (await GET(new NextRequest("https://pryva.test/api/services/catalog?country=us&feed=verification"))).json();
    const fetchMock = makeGateway({ throttleServices: true });
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(new NextRequest("https://pryva.test/api/services/catalog?country=us&feed=verification&refresh=1"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThanOrEqual(59);
    expect(body).toMatchObject({ partial: true, reason: "partial", fetchedAt: first.fetchedAt, items: [{ name: "WhatsApp" }] });
    expect(body.fetchedAt).not.toBeNull();
  });

  it("checks the exact published offer's own country before any paid call", async () => {
    const fetchMock = makeGateway({ detailCountry: "NG_234" });
    vi.stubGlobal("fetch", fetchMock);
    const attempt = vi.fn();
    const id = otpOfferPublicId("us", PRIVATE_US, "WhatsApp");
    await expect(fulfillPlan(findPlan("vn-us")!, { otpOfferId: id, onOtpAttempt: attempt, onOtpAccepted: vi.fn() }))
      .rejects.toMatchObject({ code: "OTP_OFFER_STALE" });
    expect(attempt).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => new URL(String(input)).pathname.endsWith(`/${PRIVATE_US}`))).toBe(true);
  });

  it.each([
    ["missing country", { detailCountry: null }, "OTP_OFFER_STALE"],
    ["conflicting country fields", { detailOtherCountry: "NG_234" }, "OTP_OFFER_STALE"],
    ["a contradictory country name", { detailCountryName: "France" }, "OTP_OFFER_STALE"],
    ["different offer", { detailServiceId: "some-other-offer" }, "OTP_OFFER_STALE"],
    ["an additional detail page", { detailExtraPage: true }, "OTP_OFFER_STALE"],
    ["sold out", { detailStock: 0 }, "SERVICE_UNAVAILABLE"],
    ["unknown stock", { detailStock: null }, "SERVICE_UNAVAILABLE"],
    ["a fractional stock count", { detailStock: 0.5 }, "SERVICE_UNAVAILABLE"],
    ["price above the margin floor", { detailPrice: 1_000_000 }, "UNPROFITABLE"],
    ["missing currency", { detailPrice: null }, "COST_UNKNOWN"],
  ])("refuses %s on the exact offer before the attempt marker", async (_case, detail, code) => {
    const fetchMock = makeGateway(detail);
    vi.stubGlobal("fetch", fetchMock);
    const attempt = vi.fn();
    await expect(fulfillPlan(findPlan("vn-us")!, {
      otpOfferId: otpOfferPublicId("us", PRIVATE_US, "WhatsApp"), onOtpAttempt: attempt, onOtpAccepted: vi.fn(),
    })).rejects.toMatchObject({ code });
    expect(attempt).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
  });

  it("treats a failed exact-offer read as a pre-purchase failure, not an ambiguous purchase", async () => {
    const fetchMock = makeGateway({ detailStatus: 503 });
    vi.stubGlobal("fetch", fetchMock);
    const attempt = vi.fn();
    await expect(fulfillPlan(findPlan("vn-us")!, {
      otpOfferId: otpOfferPublicId("us", PRIVATE_US, "WhatsApp"), onOtpAttempt: attempt, onOtpAccepted: vi.fn(),
    })).rejects.toMatchObject({ code: "OTP_CONFIRMATION_UNAVAILABLE" });
    expect(attempt).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
  });

  it("purchases a confirmed exact offer only after its matching country, stock and price are checked", async () => {
    const fetchMock = makeGateway({ activate: true });
    vi.stubGlobal("fetch", fetchMock);
    const attempt = vi.fn(async () => {
      expect(fetchMock.mock.calls.some(([input]) => new URL(String(input)).pathname.endsWith(`/${PRIVATE_US}`))).toBe(true);
      expect(fetchMock.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
    });
    const accepted = vi.fn();
    const result = await fulfillPlan(findPlan("vn-us")!, {
      otpOfferId: otpOfferPublicId("us", PRIVATE_US, "WhatsApp"), onOtpAttempt: attempt, onOtpAccepted: accepted,
    });
    const paid = fetchMock.mock.calls.filter(([, init]) => init.method === "POST");
    expect(attempt).toHaveBeenCalledOnce();
    expect(paid).toHaveLength(1);
    expect(JSON.parse(String(paid[0][1].body))).toMatchObject({ serviceId: PRIVATE_US });
    expect(accepted).toHaveBeenCalledWith("fake-activation");
    expect(result).toMatchObject({ provider: "bitcall", providerRequestId: "fake-activation" });
  });

  it("uses the exact-offer price for the margin check when the supplier quote changes", async () => {
    // The customer's plan price is fixed; a changed wholesale cost is acceptable
    // only if the newly confirmed amount still clears the margin floor.
    const fetchMock = makeGateway({ activate: true, detailPrice: 101 });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fulfillPlan(findPlan("vn-us")!, {
      otpOfferId: otpOfferPublicId("us", PRIVATE_US, "WhatsApp"), onOtpAttempt: vi.fn(), onOtpAccepted: vi.fn(),
    });
    expect(result.providerCostNgn).toBe(101); // mocked receipt reports the final charged amount
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
  });
});
