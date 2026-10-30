import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ limit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ createRateLimiter: () => runtime.limit }));

import {
  BitcallError,
  bitcallKeyEnvironment,
  buyBitcallEsimPlan,
  classifyRetry,
  getBitcallBalance,
  getBitcallEsimOrder,
  getBitcallEsimProfile,
  isBitcallConfigured,
  listBitcallEsimCountries,
  listBitcallEsimOrders,
  listBitcallEsimPlans,
} from "@/lib/bitcall";

const KEY_ID = "ak_test_1a2b3c";
const SECRET = "a1".repeat(64); // 128 hex characters
const SECRET_LIVE = "b2".repeat(64);

function json(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", ...headers } });
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [URL, RequestInit];
  return { url, init, headers: init.headers as Record<string, string>, body: init.body as string | undefined };
}

beforeEach(() => {
  vi.stubEnv("BITCALL_KEY_ID", KEY_ID);
  vi.stubEnv("BITCALL_API_SECRET", SECRET);
  vi.stubEnv("BITCALL_API_URL", "");
  runtime.limit.mockResolvedValue({ allowed: true });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("gateway configuration", () => {
  it("requires both halves of the credential", () => {
    expect(isBitcallConfigured()).toBe(true);
    vi.stubEnv("BITCALL_API_SECRET", "");
    expect(isBitcallConfigured()).toBe(false);
    vi.stubEnv("BITCALL_API_SECRET", SECRET);
    vi.stubEnv("BITCALL_KEY_ID", "   ");
    expect(isBitcallConfigured()).toBe(false);
  });

  it("reports the key environment from the prefix instead of trusting a label", () => {
    expect(bitcallKeyEnvironment()).toBe("test");
    vi.stubEnv("BITCALL_KEY_ID", "ak_live_9z8y");
    expect(bitcallKeyEnvironment()).toBe("live");
    // Unrecognized is reported as unknown rather than assumed to be safe.
    vi.stubEnv("BITCALL_KEY_ID", "something-else");
    expect(bitcallKeyEnvironment()).toBe("unknown");
  });

  it("refuses a malformed secret before any request goes out", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    // A wrong secret is indistinguishable from a revoked key or a disallowed IP
    // once the gateway answers, so the shape is checked locally first.
    vi.stubEnv("BITCALL_API_SECRET", "too-short");
    const error = await listBitcallEsimPlans().catch((caught: unknown) => caught) as BitcallError;
    expect(error.code).toBe("MALFORMED_SECRET");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pins the hostname, because the secret is sent as a header on every request", async () => {
    const fetchMock = vi.fn().mockImplementation(() => json({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    for (const bad of [
      "https://evil.example/api",           // a different host would receive the secret
      "http://api.bitcall.io",              // not TLS
      "https://user:pass@api.bitcall.io",   // credentials in the URL
      "https://api.bitcall.io/x?a=1",
      "https://api.bitcall.io/x#f",
    ]) {
      vi.stubEnv("BITCALL_API_URL", bad);
      const error = await listBitcallEsimPlans().catch((caught: unknown) => caught) as BitcallError;
      expect(error.code, bad).toBe("INVALID_BASE_URL");
    }
    expect(fetchMock).not.toHaveBeenCalled();

    // A path-only override on the pinned host is allowed.
    vi.stubEnv("BITCALL_API_URL", "https://api.bitcall.io");
    await listBitcallEsimPlans();
    expect(lastCall(fetchMock).url.origin).toBe("https://api.bitcall.io");
  });
});

describe("gateway transport", () => {
  it("sends both credential headers and refuses to follow a redirect", async () => {
    const fetchMock = vi.fn().mockImplementation(() => json({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await listBitcallEsimCountries();

    const { url, init, headers } = lastCall(fetchMock);
    expect(url.pathname).toBe("/v1/esim/countries");
    expect(headers["x-key-id"]).toBe(KEY_ID);
    expect(headers["x-api-secret"]).toBe(SECRET);
    expect(init.redirect).toBe("error");
    expect(init.cache).toBe("no-store");
    // The credential belongs in headers, never in a URL that reaches a log.
    expect(url.toString()).not.toContain(SECRET);
    expect(url.toString()).not.toContain(KEY_ID);
  });

  it("never contacts the gateway when the shared budget fails", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    runtime.limit.mockResolvedValueOnce({ allowed: false, unavailable: true }).mockResolvedValueOnce({ allowed: false });
    await expect(listBitcallEsimPlans()).rejects.toMatchObject({ code: "RATE_LIMIT_UNAVAILABLE" });
    await expect(listBitcallEsimPlans()).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("branches on the gateway's code, keeps requestId and fields, and drops its prose", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({
      error: {
        code: "VALIDATION_ERROR",
        message: "The request is not valid. See `fields` for what to correct.",
        requestId: "9f1c7b2e-4a83",
        fields: ["body.planId", "query.pageSize"],
      },
    }, 400, { "x-request-id": "9f1c7b2e-4a83" })));

    const error = await listBitcallEsimPlans().catch((caught: unknown) => caught) as BitcallError;
    expect(error).toBeInstanceOf(BitcallError);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.status).toBe(400);
    expect(error.requestId).toBe("9f1c7b2e-4a83");
    expect(error.fields).toEqual(["body.planId", "query.pageSize"]);
    // Their message is prose they may rewrite, and it is not ours to show anyone.
    expect(error.message).not.toContain("See `fields`");
    expect(classifyRetry(error.code)).toBe("do_not_retry");
  });

  it("captures Retry-After on a 429", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() =>
      json({ error: { code: "RATE_LIMITED", message: "slow down", requestId: "r1" } }, 429, { "Retry-After": "17" })));
    const error = await listBitcallEsimPlans().catch((caught: unknown) => caught) as BitcallError;
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryAfterSeconds).toBe(17);
    expect(classifyRetry("RATE_LIMITED")).toBe("retry_after_acting");
  });

  it("treats a body that is not JSON as a contract failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Response("<html>gateway</html>", { status: 200 })));
    await expect(listBitcallEsimPlans()).rejects.toMatchObject({ status: 502, code: "SERVICE_RESPONSE_INVALID" });
  });

  it("classifies every documented code the way the gateway says to", () => {
    expect(classifyRetry("NOT_FOUND")).toBe("do_not_retry");
    expect(classifyRetry("CONFLICT")).toBe("do_not_retry");
    expect(classifyRetry("INVALID_API_KEY")).toBe("do_not_retry");
    expect(classifyRetry("AUTHENTICATION_REQUIRED")).toBe("do_not_retry");
    expect(classifyRetry("REACTIVATION_UNAVAILABLE")).toBe("do_not_retry");
    expect(classifyRetry("INSUFFICIENT_BALANCE")).toBe("retry_after_acting");
    expect(classifyRetry("CANCELLATION_NOT_AVAILABLE_YET")).toBe("retry_after_acting");
    expect(classifyRetry("SERVICE_UNAVAILABLE")).toBe("retry_with_backoff");
    expect(classifyRetry("PRODUCT_UNAVAILABLE")).toBe("retry_with_backoff");
    expect(classifyRetry("INTERNAL_ERROR")).toBe("retry_with_backoff");
    expect(classifyRetry("SERVICE_RESPONSE_INVALID")).toBe("retry_with_backoff");
    // An unrecognized code is unknown, never silently treated as safe to retry.
    expect(classifyRetry("SOMETHING_NEW")).toBe("unknown");
    expect(classifyRetry(null)).toBe("unknown");
  });
});

describe("account balance", () => {
  it("reads the balance every product is charged against, from the envelope or bare", async () => {
    const fetchMock = vi.fn().mockImplementation(() => json({ data: { balance: "177.69", currency: "eur" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getBitcallBalance()).toEqual({ balance: 177.69, currency: "EUR" });
    expect(lastCall(fetchMock).url.pathname).toBe("/v1/balance");

    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ balance: 12.5, currency: "USD" })));
    expect(await getBitcallBalance()).toEqual({ balance: 12.5, currency: "USD" });
  });

  it("reports an unusable currency as unknown rather than assuming one", async () => {
    // Which currency the gateway bills in decides whether a returned price needs
    // conversion, so a value that is not an ISO code must not be guessed at.
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ data: { balance: 10, currency: "EURO" } })));
    expect(await getBitcallBalance()).toEqual({ balance: 10, currency: null });

    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ data: {} })));
    expect(await getBitcallBalance()).toEqual({ balance: null, currency: null });
  });

  it("surfaces an insufficient balance as the gateway's own code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() =>
      json({ error: { code: "INSUFFICIENT_BALANCE", message: "Your account balance is too low.", requestId: "r2" } }, 409)));
    const error = await getBitcallBalance().catch((caught: unknown) => caught) as BitcallError;
    expect(error).toMatchObject({ code: "INSUFFICIENT_BALANCE", status: 409 });
    // Retryable only after acting: topping up. Never blind.
    expect(classifyRetry(error.code)).toBe("retry_after_acting");
  });
});

describe("eSIM catalog", () => {
  it("reads plans from the data envelope or a bare array, dropping any without a pln_ reference", async () => {
    const rows = {
      data: [
        { planId: "pln_abc123", name: "Nigeria Lite", region: "Africa", countries: ["Nigeria", "Ghana"], allowance: 1, allowanceUnit: "GB", validity: 7, validityUnit: "days", price: "4.50", currency: "usd" },
        { id: "pln_def456", name: "Global 5GB", region: "Global", countries: [], allowance: 5, validity: 30, price: 12, currency: "EUR" },
        // A bare 24-hex database id is refused by the gateway, so it cannot be listed.
        { planId: "9OOXVUPmNmI_MPiVZuWLcO7Q", name: "No prefix" },
        { name: "No identifier at all" },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json(rows)));
    const plans = await listBitcallEsimPlans();
    expect(plans).toHaveLength(2);
    expect(plans[0]).toMatchObject({
      planId: "pln_abc123", name: "Nigeria Lite", region: "Africa",
      countries: ["Nigeria", "Ghana"], allowance: 1, allowanceUnit: "GB",
      validity: 7, validityUnit: "days", price: 4.5, currency: "USD",
    });
    // A price is surfaced exactly as returned: whether it is our cost or a
    // suggested retail figure is not decided, so nothing is converted or marked up.
    expect(plans[1]).toMatchObject({ planId: "pln_def456", price: 12, currency: "EUR", countries: [] });

    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json([rows.data[0]])));
    expect(await listBitcallEsimPlans()).toHaveLength(1);
  });

  it("passes a region filter through as a query parameter", async () => {
    const fetchMock = vi.fn().mockImplementation(() => json({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await listBitcallEsimPlans({ region: "Europe" });
    expect(lastCall(fetchMock).url.searchParams.get("region")).toBe("Europe");
  });

  it("deduplicates a repeated plan reference", async () => {
    const row = { planId: "pln_same", name: "Repeated" };
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ data: [row, row] })));
    expect(await listBitcallEsimPlans()).toHaveLength(1);
  });
});

describe("eSIM ordering", () => {
  it("refuses a non-catalog plan reference before spending anything", async () => {
    const fetchMock = vi.fn().mockImplementation(() => json({ data: { orderId: "ord_1", status: "pending" } }, 202));
    vi.stubGlobal("fetch", fetchMock);

    for (const bad of ["9OOXVUPmNmI_MPiVZuWLcO7Q", "", "  ", "pln_" + "x".repeat(200)]) {
      await expect(buyBitcallEsimPlan(bad), bad).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["body.planId"] });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends planId as the only body field and reads the 202 order back", async () => {
    const fetchMock = vi.fn().mockImplementation(() => json({ data: { orderId: "ord_1", status: "pending", esims: [] } }, 202));
    vi.stubGlobal("fetch", fetchMock);

    const order = await buyBitcallEsimPlan("pln_abc123");
    expect(order).toMatchObject({ orderId: "ord_1", status: "pending", iccids: [] });

    const { init, body } = lastCall(fetchMock);
    expect(init.method).toBe("POST");
    // A stray property is rejected by the gateway, so nothing extra is sent.
    expect(JSON.parse(body!)).toEqual({ planId: "pln_abc123" });
  });

  it("reads delivered ICCIDs from an order and reports an unrecognised status as unknown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({
      data: { orderId: "ord_2", status: "delivered", esims: [{ iccid: "8901234567890123456" }, { iccid: "8901234567890123457" }] },
    })));
    expect(await getBitcallEsimOrder("ord_2")).toMatchObject({
      status: "delivered", iccids: ["8901234567890123456", "8901234567890123457"],
    });

    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ data: { orderId: "ord_3", status: "shipping" } })));
    expect((await getBitcallEsimOrder("ord_3")).status).toBe("unknown");

    for (const status of ["pending", "processing", "partially_delivered", "failed", "refund_pending", "refunded", "cancelled", "requires_review"]) {
      vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ data: { orderId: "o", status } })));
      expect((await getBitcallEsimOrder("o")).status, status).toBe(status);
    }
  });

  it("refuses a status filter the list endpoint does not accept, rather than reading an empty list as none", async () => {
    const fetchMock = vi.fn().mockImplementation(() => json({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    for (const rejected of ["partially_delivered", "failed", "cancelled", "requires_review", "nonsense"]) {
      await expect(listBitcallEsimOrders(rejected), rejected).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["query.status"] });
    }
    expect(fetchMock).not.toHaveBeenCalled();

    for (const accepted of ["pending", "processing", "delivered", "refund_pending", "refunded"]) {
      await listBitcallEsimOrders(accepted);
    }
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("reads the activation material from a profile addressed by ICCID", async () => {
    const fetchMock = vi.fn().mockImplementation(() => json({
      data: { status: "installed", activationCode: "LPA:1$smdp.example$MATCHING-ID", appleInstallUrl: "https://apple.example/install" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const profile = await getBitcallEsimProfile("8901234567890123456");
    expect(profile).toMatchObject({ iccid: "8901234567890123456", status: "installed" });
    expect(profile.activationCode).toBe("LPA:1$smdp.example$MATCHING-ID");
    expect(profile.appleInstallUrl).toBe("https://apple.example/install");

    const { url } = lastCall(fetchMock);
    expect(url.pathname).toBe("/v1/esim/profiles/8901234567890123456");

    await expect(getBitcallEsimProfile("")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(getBitcallEsimProfile("x".repeat(41))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
