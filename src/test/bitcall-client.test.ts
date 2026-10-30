import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ limit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ createRateLimiter: () => runtime.limit }));

import {
  BitcallError,
  OTP_ACTIVATION_STATUSES,
  bitcallKeyEnvironment,
  buyBitcallEsimPlan,
  buyBitcallOtpActivation,
  cancelBitcallOtpActivation,
  classifyRetry,
  findBitcallOtpService,
  getBitcallBalance,
  getBitcallEsimOrder,
  getBitcallEsimProfile,
  getBitcallOtpActivation,
  isAmbiguousBitcallOutcome,
  isBitcallConfigured,
  listBitcallEsimCountries,
  listBitcallEsimOrders,
  listBitcallEsimPlans,
  listBitcallEsimProfiles,
  listBitcallOtpActivations,
  listBitcallOtpCountries,
  listBitcallOtpPools,
  listBitcallOtpServices,
  reactivateBitcallOtpActivation,
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

  it("never contacts the gateway when the shared budget fails, and says so unambiguously", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    runtime.limit.mockResolvedValueOnce({ allowed: false, unavailable: true }).mockResolvedValueOnce({ allowed: false });
    await expect(listBitcallEsimPlans()).rejects.toMatchObject({ code: "RATE_LIMIT_UNAVAILABLE" });
    // Distinct from the gateway's own RATE_LIMITED: nothing left this process, so
    // no money can have moved and a caller may safely do something else. Sharing
    // one code with the gateway's 429 would make that unanswerable.
    const local = await listBitcallEsimPlans().catch((caught: unknown) => caught) as BitcallError;
    expect(local).toMatchObject({ status: 429, code: "LOCAL_RATE_BUDGET" });
    expect(isAmbiguousBitcallOutcome(local)).toBe(false);
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

  it("lists every profile held, so a lost activation code is recoverable without re-buying", async () => {
    // Their docs: "A client that lost one can read it again from the profile."
    // Without this the only route back is via the order that produced it, and
    // re-buying would charge again for something already owned.
    const fetchMock = vi.fn().mockImplementation(() => json({
      data: [
        { iccid: "8901000000000000001", status: "installed", activationCode: "LPA:1$a$ONE" },
        { iccid: "8901000000000000002", status: "available", activationCode: "LPA:1$b$TWO" },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);
    const profiles = await listBitcallEsimProfiles();
    expect(profiles).toHaveLength(2);
    expect(profiles[0]).toMatchObject({ iccid: "8901000000000000001", status: "installed" });
    expect(profiles[1].activationCode).toBe("LPA:1$b$TWO");
    expect(lastCall(fetchMock).url.pathname).toBe("/v1/esim/profiles");
  });

  it("drops rows with no ICCID and de-duplicates, because such a row cannot be re-read", async () => {
    // A profile is addressed by its ICCID. A row without one cannot be matched to
    // an order or fetched again, so surfacing it would offer a dead end.
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({
      data: [
        { iccid: "8901000000000000001", activationCode: "LPA:1$a$ONE" },
        { iccid: "8901000000000000001", activationCode: "LPA:1$a$ONE" },
        { status: "installed", activationCode: "LPA:1$c$ORPHAN" },
      ],
    })));
    const profiles = await listBitcallEsimProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].iccid).toBe("8901000000000000001");
  });

  it("accepts a bare array as well as the documented envelope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json([{ iccid: "8901000000000000009" }])));
    expect(await listBitcallEsimProfiles()).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* Ambiguity: "may I retry" and "did it already happen" are different    */
/* ------------------------------------------------------------------ */

function bitcallError(code: string, status = 409) {
  return new BitcallError("x", status, code);
}

describe("outcome ambiguity on calls that spend money", () => {
  it("treats refusals the gateway states were not charged as unambiguous", async () => {
    // Their docs are explicit for the ones that spend: INSUFFICIENT_BALANCE means
    // "Nothing was charged, so no number was rented". Safe to do something else.
    for (const code of [
      "INSUFFICIENT_BALANCE", "PRODUCT_UNAVAILABLE", "VALIDATION_ERROR", "NOT_FOUND",
      "CONFLICT", "INVALID_API_KEY", "AUTHENTICATION_REQUIRED",
      "REACTIVATION_UNAVAILABLE", "CANCELLATION_NOT_AVAILABLE_YET", "RATE_LIMITED",
      "NO_KEY_ID", "NO_API_SECRET", "MALFORMED_SECRET", "INVALID_BASE_URL", "LOCAL_RATE_BUDGET",
    ]) {
      expect(isAmbiguousBitcallOutcome(bitcallError(code)), code).toBe(false);
    }
  });

  it("treats an unread outcome as ambiguous, including a non-Bitcall throw", async () => {
    for (const code of ["UPSTREAM_UNREACHABLE", "SERVICE_RESPONSE_INVALID", "INTERNAL_ERROR", "SERVICE_UNAVAILABLE", "SOMETHING_NEW", "RATE_LIMIT_UNAVAILABLE"]) {
      expect(isAmbiguousBitcallOutcome(bitcallError(code, 502)), code).toBe(true);
    }
    // An unexpected throw is precisely the case where what happened is unknown.
    expect(isAmbiguousBitcallOutcome(new TypeError("boom"))).toBe(true);
    expect(isAmbiguousBitcallOutcome(undefined)).toBe(true);
  });

  it("disagrees with classifyRetry, which is the point", async () => {
    // Both are retry_with_backoff, but only one leaves the outcome unknown. Reading
    // the retry class as a licence to resend a purchase would rent two numbers.
    expect(classifyRetry("SERVICE_UNAVAILABLE")).toBe("retry_with_backoff");
    expect(isAmbiguousBitcallOutcome(bitcallError("SERVICE_UNAVAILABLE", 503))).toBe(true);

    expect(classifyRetry("PRODUCT_UNAVAILABLE")).toBe("retry_with_backoff");
    expect(isAmbiguousBitcallOutcome(bitcallError("PRODUCT_UNAVAILABLE"))).toBe(false);

    // And a definitive refusal is still not something to hammer.
    expect(classifyRetry("INSUFFICIENT_BALANCE")).toBe("retry_after_acting");
    expect(isAmbiguousBitcallOutcome(bitcallError("INSUFFICIENT_BALANCE"))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* OTP                                                                  */
/* ------------------------------------------------------------------ */

const POOLED = {
  data: [{
    name: "WhatsApp",
    slug: "whatsapp",
    country_code: "US_1",
    pools: [
      { serviceId: "CHARLIE-US-whatsapp", price: 0.42, availableCount: 12, successRate: 87 },
      { serviceId: "ALPHA-US-whatsapp", price: 0.31, availableCount: 0, successRate: 64 },
    ],
  }],
};

describe("OTP catalog", () => {
  it("reads one offer per pool, keeping the success rate and stock it is routed on", async () => {
    const fetchMock = vi.fn().mockImplementation(() => json(POOLED));
    vi.stubGlobal("fetch", fetchMock);
    const services = await listBitcallOtpServices({ q: "whatsapp", countryCode: "US_1" });
    expect(services).toHaveLength(1);
    expect(services[0]).toMatchObject({ name: "WhatsApp", slug: "whatsapp", countryCode: "US_1" });
    expect(services[0].offers).toHaveLength(2);
    // Surfaced raw: their example reads as a percentage but the scale is not
    // documented, and normalising a guess would invert any routing built on it.
    expect(services[0].offers[0]).toEqual({
      serviceId: "CHARLIE-US-whatsapp", price: 0.42, currency: null, availableCount: 12, successRate: 87,
    });
    const { url } = lastCall(fetchMock);
    expect(url.pathname).toBe("/v1/otp/services");
    expect(url.searchParams.get("q")).toBe("whatsapp");
    expect(url.searchParams.get("country_code")).toBe("US_1");
  });

  it("drops a service whose offers carry no serviceId, since it could not be bought", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({
      data: [
        { name: "No pools" },
        { name: "Empty", pools: [] },
        { name: "Unbuyable", pools: [{ price: 0.1 }] },
        { name: "Fine", pools: [{ serviceId: "A-B-fine", price: 0.1 }] },
      ],
    })));
    const services = await listBitcallOtpServices();
    expect(services.map((s) => s.name)).toEqual(["Fine"]);
  });

  it("treats a name that matches nothing as an empty result, not an error", async () => {
    // "No result is a result": a free-text name miss returns empty data with
    // meta.total 0 rather than a 404, so it must not surface as a failure.
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ data: [], meta: { total: 0 } })));
    await expect(findBitcallOtpService("nosuchservice")).resolves.toEqual([]);
    await expect(findBitcallOtpService("")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("reads countries and pools as opaque values", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ data: [{ country_code: "US_1" }, { country_code: "ng" }] })));
    expect(await listBitcallOtpCountries()).toEqual(["US_1", "NG"]);

    // A pool is a grouping of numbers, not something you rent directly: it exists
    // only to supply the `pool` filter on the catalog.
    const fetchMock = vi.fn().mockImplementation(() => json({ data: [{ pool: "ALPHA" }, { pool: "CHARLIE" }, { pool: "ALPHA" }] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await listBitcallOtpPools()).toEqual(["ALPHA", "CHARLIE"]);
    expect(lastCall(fetchMock).url.pathname).toBe("/v1/otp/pools");
  });
});

describe("OTP activations", () => {
  it("buys with the serviceId alone and never retries a call that charges", async () => {
    const fetchMock = vi.fn().mockImplementation(() => json({
      data: { activationId: "act_1", phoneNumber: "+15551234567", price: 0.42, status: "waiting", serviceId: "CHARLIE-US-whatsapp" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const activation = await buyBitcallOtpActivation("CHARLIE-US-whatsapp");
    expect(activation).toMatchObject({
      activationId: "act_1", phoneNumber: "+15551234567", price: 0.42, status: "waiting",
      serviceId: "CHARLIE-US-whatsapp", code: null,
    });
    expect(activation.actions).toEqual({ canResend: false, canReactivate: false });
    const { url, init, body } = lastCall(fetchMock);
    expect(url.pathname).toBe("/v1/otp/activations");
    expect(init.method).toBe("POST");
    // The serviceId is sent back exactly as the catalog gave it; nothing is assembled.
    expect(JSON.parse(body ?? "{}")).toEqual({ serviceId: "CHARLIE-US-whatsapp" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("flags a timed-out purchase as ambiguous, having sent it exactly once", async () => {
    // "If it times out or fails without a clear answer, do not resend it — read
    // your orders back to see whether one was created."
    const fetchMock = vi.fn().mockRejectedValue(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
    vi.stubGlobal("fetch", fetchMock);
    const error = await buyBitcallOtpActivation("CHARLIE-US-whatsapp").catch((caught: unknown) => caught) as BitcallError;
    expect(error).toMatchObject({ code: "UPSTREAM_UNREACHABLE", status: 502 });
    expect(isAmbiguousBitcallOutcome(error)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("polls one rental by path, and a 404 stays a 404", async () => {
    const fetchMock = vi.fn().mockImplementation(() => json({
      data: { status: "received", code: "481920", actions: { canResend: true, canReactivate: false } },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const activation = await getBitcallOtpActivation("act_1");
    expect(activation).toMatchObject({ activationId: "act_1", status: "received", code: "481920" });
    expect(activation.actions.canResend).toBe(true);
    expect(lastCall(fetchMock).url.pathname).toBe("/v1/otp/activations/act_1");

    // Unknown — or not yours. Indistinguishable by design, so both must look the same.
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() =>
      json({ error: { code: "NOT_FOUND", message: "No such order", requestId: "r9" } }, 404)));
    await expect(getBitcallOtpActivation("act_nope")).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("lists activations without an activationId filter, which is the reconciliation read", async () => {
    const fetchMock = vi.fn().mockImplementation(() => json({
      data: [
        { activationId: "act_2", status: "received", code: "111111" },
        { activationId: "act_1", status: "expired" },
        { activationId: "act_1", status: "expired" },
        { status: "waiting" },
      ],
      meta: { total: 3 },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const list = await listBitcallOtpActivations({ status: "received", page: 1, pageSize: 50 });
    // De-duplicated, and a row with no id is dropped: it cannot be polled or matched.
    expect(list.map((a) => a.activationId)).toEqual(["act_2", "act_1"]);
    const { url } = lastCall(fetchMock);
    expect(url.pathname).toBe("/v1/otp/activations");
    expect(url.searchParams.get("status")).toBe("received");
    expect(url.searchParams.has("activationId")).toBe(false);
  });

  it("maps an unrecognised status to unknown rather than leaking a provider name", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ data: { activationId: "a", status: "PROVIDER_INTERNAL_HOLD" } })));
    expect((await getBitcallOtpActivation("a")).status).toBe("unknown");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ data: { activationId: "a", status: "Activating" } })));
    expect((await getBitcallOtpActivation("a")).status).toBe("activating");
    expect(OTP_ACTIVATION_STATUSES).toContain("refunded");
  });

  it("separates a cancel cooldown from a closed reactivation window", async () => {
    // Cancel too soon: lifts on its own, nothing charged, so waiting is correct.
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() =>
      json({ error: { code: "CANCELLATION_NOT_AVAILABLE_YET", message: "wait", requestId: "r1" } }, 409)));
    const cancelError = await cancelBitcallOtpActivation("a").catch((caught: unknown) => caught) as BitcallError;
    expect(classifyRetry(cancelError.code)).toBe("retry_after_acting");
    expect(isAmbiguousBitcallOutcome(cancelError)).toBe(false);

    // Reactivation window closed: canReactivate was only ever a hint. Not charged,
    // and retrying is pointless — the answer is a new number.
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() =>
      json({ error: { code: "REACTIVATION_UNAVAILABLE", message: "closed", requestId: "r2" } }, 409)));
    const reactivateError = await reactivateBitcallOtpActivation("a").catch((caught: unknown) => caught) as BitcallError;
    expect(classifyRetry(reactivateError.code)).toBe("do_not_retry");
    expect(isAmbiguousBitcallOutcome(reactivateError)).toBe(false);
  });

  it("treats a refund as something that happens to the order, not an endpoint to call", async () => {
    // "An order reaches refunded on its own — cancelling a number before its code
    // arrives returns the rental. There is no refund endpoint to call."
    const fetchMock = vi.fn().mockImplementation(() => json({ data: { activationId: "a", status: "refunded" } }));
    vi.stubGlobal("fetch", fetchMock);
    await cancelBitcallOtpActivation("a");
    expect(lastCall(fetchMock).url.pathname).toBe("/v1/otp/activations/a/cancel");
    expect((await getBitcallOtpActivation("a")).status).toBe("refunded");
  });
});
