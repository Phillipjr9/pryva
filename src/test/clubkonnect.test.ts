import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ClubkonnectAccountError,
  clubkonnectOutcome,
  isClubkonnectCatalogueConfigured,
  listClubkonnectCatalogue,
  listClubkonnectPlans,
  parseClubkonnectCatalogue,
  parseClubkonnectPlans,
  queryClubkonnectRequest,
  readClubkonnectCatalogue,
  type ClubkonnectCatalogueService,
} from "@/lib/providers/clubkonnect";

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
  it("names a refused account instead of reporting an outage", () => {
    // The host answers HTTP 200 with a fixed status word, so a plain "supplier
    // unavailable" made the page invite a retry that could never succeed.
    expect(() => parseClubkonnectPlans({ status: "INVALID_CREDENTIALS" })).toThrow(ClubkonnectAccountError);
    expect(() => parseClubkonnectPlans({ status: "MISSING_PHONE_NUMBER" })).toThrow(ClubkonnectAccountError);
    expect(() => parseClubkonnectPlans({ MOBILE_NETWORK: {} })).toThrow();
    expect(() => parseClubkonnectPlans("<html>maintenance</html>")).toThrow();
  });

  it("keeps every readable bundle when one published row is unreadable", () => {
    // One bad row used to empty the whole page: every bundle was withheld and the
    // customer was told the service was down while 30 others were fine.
    const damaged = structuredClone(catalogue);
    const products = damaged.MOBILE_NETWORK.MTN[0].PRODUCT as Record<string, string>[];
    products.push({ PRODUCT_CODE: "7", PRODUCT_NAME: "", PRODUCT_AMOUNT: "120.00" });
    products.push({ PRODUCT_CODE: "8", PRODUCT_NAME: "Broken price", PRODUCT_AMOUNT: "free" });
    products.push({ PRODUCT_CODE: "4", PRODUCT_NAME: "Duplicate identity", PRODUCT_AMOUNT: "410.50" });
    const parsed = parseClubkonnectCatalogue(damaged);
    expect(parsed.plans.map(p => p.productCode)).toEqual(["2", "4"]);
    expect(parsed.skipped).toBe(3);
    expect(parsed.emptyNetworks).toEqual([]);
  });

  it("survives a network entry that is not a list, and reports a network with nothing readable", () => {
    const payload = {
      MOBILE_NETWORK: {
        MTN: [{ ID: "01", PRODUCT: [{ PRODUCT_CODE: "2", PRODUCT_NAME: "500MB", PRODUCT_AMOUNT: "297.00" }] }],
        Glo: "unexpected shape",
        Airtel: [{ ID: "04", PRODUCT: [] }],
      },
    };
    const parsed = parseClubkonnectCatalogue(payload);
    expect(parsed.plans).toHaveLength(1);
    expect(parsed.emptyNetworks).toEqual(["Glo", "Airtel"]);
  });

  it("renders published network keys as readable names", () => {
    // The live catalogue groups 9mobile under `m_9mobile`; the key is not a label.
    const parsed = parseClubkonnectCatalogue({ MOBILE_NETWORK: {
      "m_9mobile": [{ ID: "03", PRODUCT: [{ PRODUCT_CODE: "1", PRODUCT_NAME: "50MB", PRODUCT_AMOUNT: "25.00" }] }],
      Airtel: [{ ID: "04", PRODUCT: [{ PRODUCT_CODE: "14", PRODUCT_NAME: "1GB", PRODUCT_AMOUNT: "499.91" }] }],
    } });
    expect(parsed.plans.map(p => p.network).sort()).toEqual(["9mobile", "Airtel"]);
  });

  it("needs only the account identifier to read the published catalogue", () => {
    // The plans endpoint is called without an API key, so requiring one here
    // emptied the page for a deployment whose purchase key was rotated.
    vi.stubEnv("CLUBKONNECT_USER_ID", "test-user");
    vi.stubEnv("CLUBKONNECT_API_KEY", "");
    expect(isClubkonnectCatalogueConfigured()).toBe(true);
    vi.stubEnv("CLUBKONNECT_USER_ID", "");
    expect(isClubkonnectCatalogueConfigured()).toBe(false);
  });

  it("reports how much of the live catalogue was readable", async () => {
    vi.stubEnv("CLUBKONNECT_USER_ID", "test-user");
    const payload = structuredClone(catalogue);
    (payload.MOBILE_NETWORK.MTN[0].PRODUCT as Record<string, string>[]).push({ PRODUCT_CODE: "x", PRODUCT_NAME: "Nope", PRODUCT_AMOUNT: "1.00" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
    await expect(listClubkonnectCatalogue()).resolves.toMatchObject({ skipped: 1, emptyNetworks: [] });
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

describe("catalogue transport", () => {
  it("retries one transport failure, then gives up without leaking the URL", async () => {
    vi.stubEnv("CLUBKONNECT_USER_ID", "test-user");
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error("connect timeout https://host/?UserID=test-user"))
      .mockResolvedValueOnce(Response.json(catalogue));
    vi.stubGlobal("fetch", fetcher);
    await expect(listClubkonnectCatalogue()).resolves.toMatchObject({ skipped: 0 });
    expect(fetcher).toHaveBeenCalledTimes(2);

    const failing = vi.fn().mockRejectedValue(new Error("connect timeout https://host/?UserID=test-user"));
    vi.stubGlobal("fetch", failing);
    await expect(listClubkonnectCatalogue()).rejects.toThrow("Mobile data supplier is temporarily unavailable.");
  });

  it("does not retry an account the host refused", async () => {
    vi.stubEnv("CLUBKONNECT_USER_ID", "test-user");
    const fetcher = vi.fn().mockResolvedValue(Response.json({ status: "INVALID_CREDENTIALS" }));
    vi.stubGlobal("fetch", fetcher);
    await expect(listClubkonnectCatalogue()).rejects.toThrow(ClubkonnectAccountError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
