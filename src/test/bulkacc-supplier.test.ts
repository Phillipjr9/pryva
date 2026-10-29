import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  limit: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/rate-limit", () => ({ createRateLimiter: () => runtime.limit }));
vi.mock("@/lib/logger", () => ({ logger: runtime.log }));

import {
  clearBulkaccCache,
  createOrder,
  ensureSufficientBalance,
  getBalanceMicros,
  getOrderAccounts,
  getProduct,
  isAmbiguousOutcome,
  listAllProducts,
  maskedKey,
  normalizeProduct,
  productPriceUsd,
  salvageOrderCode,
} from "@/lib/bulkacc";
import { usdCents, usdMicros, usdStringFromMicros } from "@/lib/supplier-money";

const API_KEY = "test-key-abcdef1234";

/** Every log line and every thrown message, as one searchable string. */
function logged(): string {
  const calls = [
    ...runtime.log.info.mock.calls,
    ...runtime.log.warn.mock.calls,
    ...runtime.log.error.mock.calls,
    ...runtime.log.debug.mock.calls,
  ];
  return JSON.stringify(calls);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.stubEnv("BULKACC_API_KEY", API_KEY);
  vi.stubEnv("BULKACC_API_URL", "");
  runtime.limit.mockResolvedValue({ allowed: true });
  clearBulkaccCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearBulkaccCache();
});

describe("supplier client: money-spending safety", () => {
  it("never reaches the network from the demo, without a key, or when budgeting fails", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    vi.stubEnv("BULKACC_API_KEY", "");
    await expect(createOrder("300004", 1)).rejects.toMatchObject({ code: "not_configured" });

    vi.stubEnv("BULKACC_API_KEY", API_KEY);
    runtime.limit
      .mockResolvedValueOnce({ allowed: false, unavailable: true })
      .mockResolvedValueOnce({ allowed: false });
    await expect(createOrder("300004", 1)).rejects.toMatchObject({ code: "rate_limit_unavailable" });
    await expect(createOrder("300004", 1)).rejects.toMatchObject({ code: "rate_limit_exceeded" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pins the base URL so the key cannot be forwarded, and refuses redirects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    for (const url of [
      "http://bulkacc.com",
      "https://attacker.test",
      "https://bulkacc.com.evil.test",
      "https://bulkacc.com:8443",
      "https://user:pass@bulkacc.com",
      "https://bulkacc.com/?forward=evil",
    ]) {
      vi.stubEnv("BULKACC_API_URL", url);
      await expect(getBalanceMicros()).rejects.toMatchObject({ code: "invalid_base_url" });
    }
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv("BULKACC_API_URL", "");
    await getBalanceMicros();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith("https://bulkacc.com/api/accounts?apiKey=")).toBe(true);
    expect(options.redirect).toBe("error");
    expect(options.cache).toBe("no-store");
  });

  it("puts the key in the query string but never in a log line", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ accountInformation: "user|pass|recovery" }] }));
    vi.stubGlobal("fetch", fetchMock);

    await getOrderAccounts("3120240416094425327");

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain(`apiKey=${API_KEY}`);
    // The URL is the one place the key exists; it must not be copied into logs,
    // and neither must the credentials it fetched.
    expect(logged()).not.toContain(API_KEY);
    expect(logged()).not.toContain("user|pass|recovery");
    expect(maskedKey()).toBe("…1234");
    expect(maskedKey()).not.toContain(API_KEY.slice(0, 8));
  });

  it("treats the documented failure shape (HTTP 200, statusCode 200, data null) as a refusal", async () => {
    // This is the trap in the published contract: an order that was NOT placed
    // still answers 200/200. Branching on the status code would report success
    // and deliver nothing.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse({ data: null, statusCode: 200, message: "insufficient account balance!" }),
    ));

    await expect(createOrder("300004", 10)).rejects.toMatchObject({ code: "insufficient_supplier_balance" });
    expect(logged()).not.toContain(API_KEY);
  });

  it("salvages an order code from a malformed body instead of stranding a paid order", async () => {
    // The published success example is not valid JSON. If a real response ever
    // arrives that way, the code still has to be recovered: losing it means the
    // customer paid, the stock was bought, and nobody can fetch the accounts.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse('{"data":"3120240416094425327" "statusCode":200, "message":"success"}'),
    ));

    await expect(createOrder("300004", 2)).resolves.toEqual({ orderCode: "3120240416094425327" });
    expect(salvageOrderCode('{"data":"3120240416094425327" "statusCode":200}')).toBe("3120240416094425327");
    expect(salvageOrderCode("<html>gateway timeout</html>")).toBeNull();
  });

  it("reports an unknown outcome — never a retry — when a spent request cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse("<html>502 gateway</html>")));
    const ambiguousBody = await createOrder("300004", 1).then(() => null, (error: unknown) => error);
    expect(isAmbiguousOutcome(ambiguousBody)).toBe(true);
    expect(ambiguousBody).toMatchObject({ code: "ambiguous_outcome" });

    // A timeout after the request was sent is equally unknowable.
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchMock = vi.fn().mockRejectedValue(abort);
    vi.stubGlobal("fetch", fetchMock);
    const timedOut = await createOrder("300004", 1).then(() => null, (error: unknown) => error);
    expect(isAmbiguousOutcome(timedOut)).toBe(true);
    expect(timedOut).toMatchObject({ code: "timeout" });
    // Exactly one attempt: an automatic retry could buy twice.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a logical failure that arrives with a 4xx statusCode", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse({ statusCode: 404, message: "product 300004 does not exist or stop selling!" }),
    ));
    await expect(getProduct("300004")).rejects.toMatchObject({ code: "logical_error", status: 404 });
  });

  it("checks the prepaid balance first and fails open when the balance cannot be read", async () => {
    // A fresh Response per call: a reused one has an already-consumed body, which
    // would test the client's empty-body path instead of the balance itself.
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => jsonResponse({ data: 1.5 })));
    expect(await getBalanceMicros()).toBe(1_500_000);
    expect(await ensureSufficientBalance(1_000_000)).toBe(true);
    expect(await ensureSufficientBalance(2_000_000)).toBe(false);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    // An unreadable balance must not block a sale; the order call still guards.
    expect(await ensureSufficientBalance(1_000_000)).toBe(true);
  });

  it("validates product codes and quantities before spending anything", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const code of ["../secrets", "300004 OR 1=1", "", "x".repeat(21)]) {
      await expect(createOrder(code, 1)).rejects.toMatchObject({ code: "bad_product" });
      await expect(getProduct(code)).rejects.toMatchObject({ code: "bad_product" });
    }
    for (const quantity of [0, -1, 1.5, 1001]) {
      await expect(createOrder("300004", quantity)).rejects.toMatchObject({ code: "bad_quantity" });
    }
    await expect(getOrderAccounts("short")).rejects.toMatchObject({ code: "bad_order_code" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed products rather than trusting them into the storefront", async () => {
    expect(() => normalizeProduct(null)).toThrow();
    expect(() => normalizeProduct({ code: "1", name: "" })).toThrow();
    expect(() => normalizeProduct({ code: "bad code!", name: "x" })).toThrow();
    expect(() => normalizeProduct({ code: "1", name: "x", price: 0 })).toThrow();
    expect(() => normalizeProduct({ code: "1", name: "x", price: "free" })).toThrow();
    expect(() => normalizeProduct({ code: "1", name: "x", price: -3 })).toThrow();

    const product = normalizeProduct({
      code: "300004", name: "Instagram account", price: 0.06992, inStock: 3449, min: 1,
      groupName: "Instagram", categoryName: "Aged Instagram", description: "d",
    });
    expect(product.priceMicros).toBe(69_920);
    expect(product.inStock).toBe(3449);
    expect(productPriceUsd(product)).toBe("0.069920");

    // A missing stock figure is unknown, not zero — zero would hide a listing.
    expect(normalizeProduct({ code: "1", name: "x", price: "1.00", inStock: "lots" }).inStock).toBeNull();
    // An absurd minimum must not become a real order constraint.
    expect(normalizeProduct({ code: "1", name: "x", price: "1.00", min: 99999 }).min).toBe(100);
  });

  it("parses supplier money as integers, rounding a cost up and a discount down", () => {
    expect(usdMicros(0.06992)).toBe(69_920);
    expect(usdMicros("0.44")).toBe(440_000);
    expect(usdMicros("3.48000")).toBe(3_480_000);
    // Sub-cent precision must survive: floats would drift on repeated arithmetic.
    expect(usdStringFromMicros(69_920)).toBe("0.069920");
    expect(usdMicros(usdStringFromMicros(69_920))).toBe(69_920);
    // Digits past the sixth round the magnitude up, never down.
    expect(usdMicros("0.0000001")).toBe(1);
    expect(usdCents(0.06992)).toBe(7);
    expect(usdCents(0.06992, "down")).toBe(6);
    expect(() => usdMicros("1e-9")).toThrow();
    expect(() => usdMicros(Number.NaN)).toThrow();
    expect(() => usdMicros("9".repeat(12))).toThrow();
  });

  it("walks the catalog once, de-duplicates codes and serves the second read from cache", async () => {
    const page = (items: unknown[], totalPages: number) =>
      jsonResponse({ data: { items, totalCount: items.length, pageIndex: 1, pageSize: 200, totalPages }, statusCode: 200, message: "success" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(page([
        { code: "1", name: "Aged USA Spotify", price: 1.2, inStock: 32949, min: 1, groupName: "Spotify", categoryName: "Aged USA Spotify" },
        { code: "1", name: "Duplicate code", price: 1.2, inStock: 5, min: 1 },
        { code: "bad code!", name: "Rejected", price: 1.2 },
      ], 2))
      .mockResolvedValueOnce(page([
        { code: "2", name: "Warmed up Gmail", price: 0.8, inStock: 7969, min: 1, groupName: "Google", categoryName: "Gmail" },
      ], 2));
    vi.stubGlobal("fetch", fetchMock);

    const products = await listAllProducts();
    expect(products.map((product) => product.code)).toEqual(["1", "2"]);

    const callsAfterFirstWalk = fetchMock.mock.calls.length;
    await listAllProducts();
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterFirstWalk);

    // A malformed row is skipped, not fatal, and the reason is logged without the key.
    expect(logged()).toContain("bad_product");
    expect(logged()).not.toContain(API_KEY);
  });
});
