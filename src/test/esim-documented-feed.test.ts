import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const limit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/platform/rate-limit", () => ({ createRateLimiter: () => limit }));
vi.mock("@/lib/platform/demo-policy", () => ({ isPreviewDatabase: () => false }));

import { catalogueItems, esimItemsForCountry, esimOfferTerms, readEsimCatalog, recheckEsimOffer } from "@/lib/services/esim/esim-catalog";
import { clearRateCache } from "@/lib/payments/exchange-rate";

function json(data: unknown) {
  return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.stubEnv("BITCALL_KEY_ID", "ak_test_fixture");
  vi.stubEnv("BITCALL_API_SECRET", "aa".repeat(64));
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("EUR_NGN_RATE", "1800");
  vi.stubEnv("EXCHANGE_RATE_API_KEY", "");
  limit.mockResolvedValue({ allowed: true });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); clearRateCache(); });

describe("documented eSIM feed through the storefront mapper", () => {
  it("shows plans from multiple pages, converts nested EUR prices and retains unpriced listings", async () => {
    const uk = {
      planId: "pln_uk_documented_example", name: "UK 1MB Test Plan", region: "United Kingdom", countryCode: "GB", countries: ["GB"],
      dataMb: 1, unlimitedData: false, validityDays: 5, price: { amount: 0.74, currency: "EUR" },
      capabilities: { data: true, voice: false, sms: false },
    };
    const nigeria = {
      planId: "pln_nigeria_second_page", name: "Nigeria 1 GB", region: "Nigeria", countryCode: "NG", countries: ["NG"],
      dataMb: 1024, unlimitedData: false, validityDays: 7, price: { amount: 0.87, currency: "EUR" },
    };
    const noRate = { ...nigeria, planId: "pln_nigeria_other_currency", name: "Nigeria price pending", price: { amount: 2, currency: "GBP" } };
    const fetchMock = vi.fn().mockImplementation((url: URL, init: RequestInit) => {
      expect(init.method).toBe("GET");
      if (url.pathname === "/v1/esim/countries") return json({ data: [{ code: "GB", name: "United Kingdom" }] });
      if (url.pathname === "/v1/esim/plans/pln_nigeria_second_page") return json({ data: nigeria });
      if (url.pathname === "/v1/esim/plans" && url.searchParams.get("page") === "1") {
        return json({ data: [uk], meta: { page: 1, pageSize: 200, hasNext: true } });
      }
      if (url.pathname === "/v1/esim/plans" && url.searchParams.get("page") === "2") {
        return json({ data: [nigeria, noRate], meta: { page: 2, pageSize: 200, hasNext: false } });
      }
      throw new Error("Unexpected request");
    });
    vi.stubGlobal("fetch", fetchMock);

    const catalog = await readEsimCatalog(true);
    expect(catalog.partial).toBe(false);
    expect(catalog.stats).toMatchObject({ returned: 3, priced: 2, skippedCurrency: 1 });
    expect(catalog.offers.find((plan) => plan.planId === uk.planId)).toMatchObject({ costNgn: 1332, dataLabel: "1MB of data", validityLabel: "5 days" });
    const offer = catalog.offers.find((plan) => plan.planId === nigeria.planId)!;
    expect(offer).toMatchObject({ costNgn: 1566, dataLabel: "1GB of data", validityLabel: "7 days", purchasable: true });
    const fresh = await recheckEsimOffer(offer);
    expect(fresh).toMatchObject({ id: offer.id, priceNgn: offer.priceNgn });
    expect(esimOfferTerms(fresh!)).toBe(esimOfferTerms(offer));
    const publicList = catalogueItems(catalog.listings);
    expect(publicList.find((item) => item.name === "Nigeria price pending")).toMatchObject({ priceNgn: null, purchasable: false });
    expect(esimItemsForCountry(catalog.listings, "ng")).toHaveLength(2);
    expect(JSON.stringify(publicList)).not.toMatch(/pln_|1332|1566|bitcall/i);
    expect(fetchMock.mock.calls.every((call) => (call[1] as RequestInit).method === "GET")).toBe(true);
  });
  it.each([
    ["not configured", ""],
    ["unavailable", "fake-rate-service-key"],
  ])("still lists documented EUR plans safely if the rate service is %s", async (_reason, key) => {
    vi.stubEnv("EUR_NGN_RATE", "");
    vi.stubEnv("EXCHANGE_RATE_API_KEY", key);
    const fetchMock = vi.fn().mockImplementation((url: URL | string) => {
      if (typeof url === "string" && url.startsWith("https://v6.exchangerate-api.com/v6/latest/")) return new Response("down", { status: 503 });
      const parsed = url as URL;
      if (parsed.pathname === "/v1/esim/countries") return json({ data: [] });
      if (parsed.pathname === "/v1/esim/plans") return json({ data: [{
        planId: "pln_eur_unpriced", name: "Nigeria data", region: "Nigeria", countries: ["NG"],
        dataMb: 1024, validityDays: 7, price: { amount: 0.87, currency: "EUR" },
      }], meta: { page: 1, hasNext: false } });
      throw new Error("Unexpected request");
    });
    vi.stubGlobal("fetch", fetchMock);
    const catalog = await readEsimCatalog(true);
    expect(catalog.offers).toEqual([]);
    expect(catalog.stats.skippedRate).toBe(1);
    expect(catalogueItems(catalog.listings)[0]).toMatchObject({ name: "Nigeria data", dataLabel: "1GB of data", priceNgn: null, purchasable: false });
    expect(esimItemsForCountry(catalog.listings, "ng")[0]).toMatchObject({ price: null, action: null });
    const rateCalls = fetchMock.mock.calls.filter(([url]) => typeof url === "string");
    expect(rateCalls).toHaveLength(key ? 1 : 0);
  });

});
