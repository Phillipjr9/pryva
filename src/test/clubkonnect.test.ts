import { afterEach, describe, expect, it, vi } from "vitest";
import { clubkonnectOutcome, listClubkonnectPlans, parseClubkonnectPlans, queryClubkonnectRequest, readClubkonnectCatalogue, type ClubkonnectCatalogueService } from "@/lib/providers/clubkonnect";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const catalogue = { MOBILE_NETWORK: { MTN: [{ ID: "01", PRODUCT: [
  { PRODUCT_CODE: "4", PRODUCT_NAME: "1GB Weekly", PRODUCT_AMOUNT: "410.50" },
  { PRODUCT_CODE: "2", PRODUCT_NAME: "500MB Weekly", PRODUCT_AMOUNT: "297.00" },
] }] } };

describe("ClubKonnect documented contract", () => {
  it("uses PRODUCT_CODE, preserves leading-zero network IDs, exact kobo and cheapest-first order", () => {
    const plans = parseClubkonnectPlans(catalogue);
    expect(plans.map(p => p.productCode)).toEqual(["2", "4"]);
    expect(plans[1]).toMatchObject({ networkCode: "01", publishedAmountKobo: 41050, stock: null });
  });
  it("refuses malformed envelopes and duplicate product identities", () => {
    expect(() => parseClubkonnectPlans({ status: "INVALID_CREDENTIALS" })).toThrow();
    const duplicate = structuredClone(catalogue);
    duplicate.MOBILE_NETWORK.MTN[0].PRODUCT.push(duplicate.MOBILE_NETWORK.MTN[0].PRODUCT[0]);
    expect(() => parseClubkonnectPlans(duplicate)).toThrow();
  });
  it.each(["100", "199", "201", "299", "300", "412", "521", "600", "899"])("does not mark code %s as delivered or refundable", code => {
    expect(clubkonnectOutcome({ statuscode: code, status: "ORDER_COMPLETED" })).toBe("pending");
  });
  it("requires both success code and status, including documented casing variants", () => {
    expect(clubkonnectOutcome({ statusCode: 200, status: "ORDER_COMPLETED" })).toBe("delivered");
    expect(clubkonnectOutcome({ statuscode: "200", orderstatus: "ORDER_PROCESSING" })).toBe("pending");
    expect(clubkonnectOutcome({ statuscode: "509", orderstatus: "ORDER_CANCELLED" })).toBe("cancelled");
  });
  it("fetches catalogue server-side without API key and forbids redirects", async () => {
    vi.stubEnv("CLUBKONNECT_USER_ID", "test-user");
    vi.stubEnv("CLUBKONNECT_API_KEY", "test-secret");
    const fetcher = vi.fn().mockResolvedValue(Response.json(catalogue));
    vi.stubGlobal("fetch", fetcher);
    await listClubkonnectPlans();
    const [url, options] = fetcher.mock.calls[0];
    expect(url.origin).toBe("https://www.nellobytesystems.com");
    expect(url.searchParams.has("APIKey")).toBe(false);
    expect(options).toMatchObject({ redirect: "error", cache: "no-store" });
  });
  it.each(["airtime", "data", "cable", "electricity", "recharge-pins", "smile", "waec", "jamb"] as ClubkonnectCatalogueService[])("reads only a documented catalogue for %s", async service => {
    vi.stubEnv("CLUBKONNECT_USER_ID", "test-user");
    const fetcher = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal("fetch", fetcher);
    await readClubkonnectCatalogue(service);
    const url = fetcher.mock.calls[0][0] as URL;
    expect(url.pathname).toMatch(/(?:NetworkV2|PlansV3|PackagesV2|DiscosV1|DiscountV2)\.asp$/);
    expect(url.searchParams.has("APIKey")).toBe(false);
  });
  it("rejects arbitrary endpoint and prototype keys without a request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    for (const key of ["/APIAirtimeV1.asp", "toString", "__proto__"]) {
      await expect(readClubkonnectCatalogue(key as ClubkonnectCatalogueService)).rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("never exposes credentials from outbound errors", async () => {
    vi.stubEnv("CLUBKONNECT_USER_ID", "test-user");
    vi.stubEnv("CLUBKONNECT_API_KEY", "test-secret");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("URL with test-secret")));
    await expect(queryClubkonnectRequest("request-123")).rejects.toThrow("Mobile data supplier is temporarily unavailable.");
  });
});
