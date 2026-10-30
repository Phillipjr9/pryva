import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ limit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ createRateLimiter: () => runtime.limit }));

import {
  SmmPanelError,
  addSmmOrder,
  getSmmBalance,
  getSmmOrderStatus,
  isSmmPanelConfigured,
  listSmmServices,
  normalizeTargetLink,
  panelEndpoint,
  requestSmmRefill,
} from "@/lib/smm-panel";

const KEY = "panel-secret-key";
const ENDPOINT = "https://example-panel.test/api/v2";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

/** The panel service rows, using the stringified numbers panels really send. */
const ROWS = [
  {
    service: 101, name: "Instagram Followers | Real | 365 Days Refill", category: "Instagram - Followers",
    type: "Default", rate: "0.7400", min: "10", max: "10000000", refill: true, cancel: true, dripfeed: false,
  },
  { service: "202", name: "TikTok Views", category: "TikTok", rate: 0.5, min: 100, max: 1000, refill: "1", cancel: "no", dripfeed: "true" },
  { name: "no identifier, so it cannot be ordered" },
];

beforeEach(() => {
  vi.stubEnv("SMM_PANEL_API_KEY", KEY);
  vi.stubEnv("SMM_PANEL_API_URL", ENDPOINT);
  runtime.limit.mockResolvedValue({ allowed: true });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("SMM panel configuration", () => {
  it("requires both the key and the endpoint", () => {
    expect(isSmmPanelConfigured()).toBe(true);
    vi.stubEnv("SMM_PANEL_API_KEY", "");
    expect(isSmmPanelConfigured()).toBe(false);
    vi.stubEnv("SMM_PANEL_API_KEY", KEY);
    vi.stubEnv("SMM_PANEL_API_URL", "   ");
    expect(isSmmPanelConfigured()).toBe(false);
  });

  it("refuses an endpoint that is not https, carries credentials, or points inward", () => {
    for (const bad of [
      "http://example-panel.test/api/v2",
      "https://user:pass@example-panel.test/api/v2",
      "https://localhost/api/v2",
      "https://app.localhost/api/v2",
      "https://127.0.0.1/api/v2",
      "https://10.1.2.3/api/v2",
      "https://192.168.1.1/api/v2",
      "https://172.16.0.1/api/v2",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/api/v2",
      "https://example-panel.test/api/v2?leak=1",
      "https://example-panel.test/api/v2#frag",
      "not a url",
    ]) {
      vi.stubEnv("SMM_PANEL_API_URL", bad);
      let code: string | undefined;
      try { panelEndpoint(); } catch (error) { code = (error as SmmPanelError).code; }
      expect(code, bad).toBe("INVALID_API_URL");
    }
    vi.stubEnv("SMM_PANEL_API_URL", "https://example-panel.test/api/v2///");
    expect(panelEndpoint()).toBe("https://example-panel.test/api/v2");
  });
});

describe("SMM panel transport", () => {
  it("never contacts the panel when the shared budget fails", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    runtime.limit.mockResolvedValueOnce({ allowed: false, unavailable: true }).mockResolvedValueOnce({ allowed: false });
    await expect(listSmmServices()).rejects.toMatchObject({ code: "RATE_LIMIT_UNAVAILABLE" });
    await expect(listSmmServices()).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("puts the key in the body and never in the URL", async () => {
    const fetchMock = vi.fn().mockImplementation(() => json([]));
    vi.stubGlobal("fetch", fetchMock);
    await listSmmServices();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // A key in a query string ends up in access logs and browser history.
    expect(url).toBe(ENDPOINT);
    expect(url).not.toContain(KEY);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("key")).toBe(KEY);
    expect(body.get("action")).toBe("services");
  });

  it("treats an HTTP 200 carrying an error field as a rejection, without echoing it", async () => {
    // This is the trap: panels reject with a success status code.
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ error: "Invalid API key. Balance: 999" })));
    const caught = await listSmmServices().catch((error: unknown) => error) as SmmPanelError;
    expect(caught).toBeInstanceOf(SmmPanelError);
    expect(caught.code).toBe("PANEL_REJECTED");
    // Upstream text can carry the key or the balance, so it is never surfaced.
    expect(caught.message).not.toContain("Invalid API key");
    expect(caught.message).not.toContain("999");
  });

  it("maps transport failures onto distinct codes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Response("", { status: 429 })));
    await expect(listSmmServices()).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });

    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Response("", { status: 500 })));
    await expect(listSmmServices()).rejects.toMatchObject({ status: 502, code: "UPSTREAM_ERROR" });

    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Response("<html>nope</html>", { status: 200 })));
    await expect(listSmmServices()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      const timeout = new Error("timed out"); timeout.name = "TimeoutError"; throw timeout;
    }));
    await expect(listSmmServices()).rejects.toMatchObject({ code: "UPSTREAM_UNREACHABLE" });

    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => { throw new Error("dns failed"); }));
    await expect(listSmmServices()).rejects.toMatchObject({ code: "UPSTREAM_UNREACHABLE" });
  });
});

describe("SMM panel catalog", () => {
  it("reads a bare array or a wrapped catalog, coercing stringified numbers and flags", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json(ROWS)));
    const fromArray = await listSmmServices();
    expect(fromArray).toHaveLength(2);
    expect(fromArray[0]).toMatchObject({
      id: "101", name: "Instagram Followers | Real | 365 Days Refill", category: "Instagram - Followers",
      ratePer1000: 0.74, min: 10, max: 10_000_000, refill: true, cancel: true, dripfeed: false,
    });
    expect(fromArray[1]).toMatchObject({ id: "202", ratePer1000: 0.5, refill: true, cancel: false, dripfeed: true });

    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ services: ROWS })));
    expect(await listSmmServices()).toHaveLength(2);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ data: ROWS })));
    expect(await listSmmServices()).toHaveLength(2);
  });

  it("drops a repeated service identifier rather than listing it twice", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json([ROWS[0], ROWS[0]])));
    expect(await listSmmServices()).toHaveLength(1);
  });

  it("reads the balance and normalizes the currency, leaving an unusable one null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ balance: "177.69", currency: "usd" })));
    expect(await getSmmBalance()).toEqual({ balance: 177.69, currency: "USD" });

    // Billing currency drives retail pricing, so a value that is not an ISO code
    // is reported as unknown rather than guessed.
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ balance: "10", currency: "DOLLARS" })));
    expect(await getSmmBalance()).toEqual({ balance: 10, currency: null });
  });
});

describe("SMM panel ordering", () => {
  it("validates before contacting the panel, so a bad order is never placed", async () => {
    const fetchMock = vi.fn().mockImplementation(() => json({ order: 23501 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await addSmmOrder({ service: "101", link: "instagram.com/praizy", quantity: 1000 })).toEqual({ orderId: "23501" });
    const body = new URLSearchParams((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.get("action")).toBe("add");
    expect(body.get("service")).toBe("101");
    expect(body.get("link")).toBe("https://instagram.com/praizy");
    expect(body.get("quantity")).toBe("1000");

    await expect(addSmmOrder({ service: "101", link: "instagram.com/x", quantity: 0 })).rejects.toMatchObject({ code: "INVALID_QUANTITY" });
    await expect(addSmmOrder({ service: "101", link: "instagram.com/x", quantity: 1.5 })).rejects.toMatchObject({ code: "INVALID_QUANTITY" });
    await expect(addSmmOrder({ service: "101", link: "instagram.com/x", quantity: -10 })).rejects.toMatchObject({ code: "INVALID_QUANTITY" });
    await expect(addSmmOrder({ service: "  ", link: "instagram.com/x", quantity: 10 })).rejects.toMatchObject({ code: "INVALID_SERVICE" });
    await expect(addSmmOrder({ service: "101", link: "javascript:alert(1)", quantity: 10 })).rejects.toMatchObject({ code: "INVALID_LINK" });
    await expect(addSmmOrder({ service: "101", link: "https://localhost/x", quantity: 10 })).rejects.toMatchObject({ code: "INVALID_LINK" });
    // Exactly one call: the six rejected attempts never reached the network.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails loudly rather than implying success when no order reference comes back", async () => {
    // The order may still have been placed, so the caller must reconcile by
    // status instead of retrying: there is no idempotency key.
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ status: "ok" })));
    await expect(addSmmOrder({ service: "101", link: "https://instagram.com/x", quantity: 10 })).rejects.toMatchObject({ code: "NO_ORDER_ID" });
  });

  it("normalizes the order states panels actually return", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() =>
      json({ charge: "0.27819", start_count: "3572", status: "Partial", remains: "157", currency: "USD" })));
    expect(await getSmmOrderStatus("23501")).toEqual({
      orderId: "23501", status: "partial", remains: 157, startCount: 3572, charge: 0.27819, currency: "USD",
    });

    const cases: Array<[string | null, string]> = [
      ["In progress", "in_progress"], ["Processing", "in_progress"], ["Completed", "completed"],
      ["Partial", "partial"], ["Partially Completed", "partial"], ["Canceled", "canceled"],
      ["Cancelled", "canceled"], ["Refunded", "canceled"], ["Pending", "pending"],
      ["Queued", "pending"], ["Something unrecognised", "unknown"], [null, "unknown"],
    ];
    for (const [raw, expected] of cases) {
      vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ status: raw })));
      expect((await getSmmOrderStatus("1")).status, String(raw)).toBe(expected);
    }
  });

  it("reports the remainder a partial delivery left undelivered", async () => {
    // `remains` is what makes an automatic refund of the undelivered portion
    // possible, so a panel that omits it must read as null, never as zero.
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ status: "Partial" })));
    expect((await getSmmOrderStatus("1")).remains).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ status: "Partial", remains: "0" })));
    expect((await getSmmOrderStatus("1")).remains).toBe(0);
  });

  it("requests a refill and tolerates a panel that returns no refill identifier", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ refill: 9871 })));
    expect(await requestSmmRefill("23501")).toEqual({ refillId: "9871", status: "unknown" });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ success: "Your order will be refilled", status: "Completed" })));
    expect(await requestSmmRefill("23501")).toEqual({ refillId: null, status: "completed" });
  });
});

describe("target link validation", () => {
  it("accepts public https profile and post URLs and upgrades a bare host", () => {
    expect(normalizeTargetLink("instagram.com/praizy")).toBe("https://instagram.com/praizy");
    expect(normalizeTargetLink("https://www.tiktok.com/@x/video/1")).toBe("https://www.tiktok.com/@x/video/1");
    expect(normalizeTargetLink("  https://youtube.com/watch?v=abc  ")).toBe("https://youtube.com/watch?v=abc");
  });

  it("rejects anything that is not a public https URL", () => {
    for (const bad of [
      "http://instagram.com/x", "https://user:pw@instagram.com/x", "https://localhost/x",
      "https://127.0.0.1/x", "https://169.254.169.254/x", "https://internal/x", "javascript:alert(1)",
      "", "   ", 42, null, undefined, {}, "x".repeat(501),
    ]) {
      expect(normalizeTargetLink(bad), String(bad)).toBeNull();
    }
  });
});
