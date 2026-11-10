import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ limit: vi.fn() }));
vi.mock("@/lib/platform/rate-limit", () => ({ createRateLimiter: () => runtime.limit }));

import { buyFleexaEmail, buyFleexaRental, buyFleexaSmsNumber, checkFleexaEmail, listFleexaRentAreas, listFleexaSmsServices } from "@/lib/providers/fleexa";

beforeEach(() => {
  vi.stubEnv("FLEEXA_API_KEY", "provider-secret");
  vi.stubEnv("FLEEXA_BASE_URL", "");
  vi.stubEnv("FLEEXA_API_URL", "");
  runtime.limit.mockResolvedValue({ allowed: true });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("supplier client safety", () => {
  it("never calls the supplier when shared budgeting fails", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    runtime.limit.mockResolvedValueOnce({ allowed: false, unavailable: true }).mockResolvedValueOnce({ allowed: false });
    await expect(listFleexaSmsServices()).rejects.toMatchObject({ code: "RATE_LIMIT_UNAVAILABLE" });
    await expect(listFleexaSmsServices()).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends paid actions as POST with the key in headers, never in the URL", async () => {
    // One payload carrying every alias so each parser finds its own field.
    const receipt = { data: { request_id: "req-1", phone_number: "+2348000000000", email_id: "mail-1", email: "inbox@example.test", rental_id: "rent-1" } };
    // A Response body can only be read once, so build a fresh one per call.
    const fetchMock = vi.fn().mockImplementation(() => new Response(JSON.stringify(receipt), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await buyFleexaSmsNumber({ country: "ng" })).toMatchObject({ requestId: "req-1", number: "+2348000000000" });
    expect(await buyFleexaEmail()).toMatchObject({ emailId: "mail-1", address: "inbox@example.test" });
    expect(await buyFleexaRental({ area: "ng", months: 1 })).toMatchObject({ rentalId: "rent-1" });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const paths = ["/sms4/buy", "/email/buy", "/rent/sms4/buy"];
    fetchMock.mock.calls.forEach((call, index) => {
      const [url, init] = call as [string, RequestInit & { headers: Record<string, string> }];
      expect(url.endsWith(paths[index]), url).toBe(true);
      // The key must ride in headers: a key in a query string ends up in logs.
      expect(url).not.toContain("provider-secret");
      expect(init.method).toBe("POST");
      expect(init.redirect).toBe("error");
      expect(init.headers.Authorization).toBe("Bearer provider-secret");
      expect(init.headers["X-API-Key"]).toBe("provider-secret");
    });
  });

  it("records a rental reference before rejecting an incomplete paid receipt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { rental_id: "rent-incomplete" } }), { status: 200 })));
    const accepted = vi.fn().mockResolvedValue(undefined);
    await expect(buyFleexaRental({ area: "ng", months: 1 }, accepted))
      .rejects.toMatchObject({ code: "INCOMPLETE_RECEIPT" });
    expect(accepted).toHaveBeenCalledOnce();
    expect(accepted).toHaveBeenCalledWith("rent-incomplete");
  });

  it("polls the purchased inbox and extracts an OTP from HTML when the API omits a code field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        messages: [{
          subject: "Confirm your email",
          from: "security@example.com",
          html: "<p>Your verification code is <strong>482901</strong></p>",
          received_at: "2026-11-08T08:00:00Z",
        }],
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkFleexaEmail("mail/1");
    expect(result.code).toBe("482901");
    expect(result.messages).toMatchObject([{
      subject: "Confirm your email",
      from: "security@example.com",
      code: "482901",
      receivedAt: "2026-11-08T08:00:00Z",
    }]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://fleexa.com.ng/developer/email/check/mail%2F1");
  });

  it("rejects credential-exfiltrating base URLs and never follows redirects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    for (const url of ["http://fleexa.com.ng/developer", "https://attacker.test/developer", "https://fleexa.com.ng/developer?next=evil", "https://fleexa.com.ng:443/other"]) {
      vi.stubEnv("FLEEXA_BASE_URL", url);
      await expect(listFleexaSmsServices()).rejects.toMatchObject({ code: "INVALID_BASE_URL" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv("FLEEXA_BASE_URL", "https://fleexa.com.ng/developer");
    await listFleexaSmsServices();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://fleexa.com.ng/developer/sms4/apps");
    expect(options.redirect).toBe("error");
    expect(options.headers).toMatchObject({ Authorization: "Bearer provider-secret" });
  });

  it("reports an unfunded account as a funding refusal, not an outage", async () => {
    // Fleexa refuses an unfunded account in prose — sometimes even with a 200 and
    // success:false. Both used to land as a generic 502, which is why an empty
    // balance rendered as "catalogue unavailable, retry".
    const refuse = (payload: unknown, status: number) => {
      vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Response(JSON.stringify(payload), { status })));
    };

    refuse({ success: false, message: "Insufficient balance to complete this request" }, 200);
    await expect(listFleexaSmsServices()).rejects.toMatchObject({ status: 402, code: "INSUFFICIENT_BALANCE" });

    refuse({ message: "Not enough funds. provider-secret" }, 402);
    const refusal = await listFleexaSmsServices().catch((error: unknown) => error) as Error;
    expect(refusal).toMatchObject({ status: 402, code: "INSUFFICIENT_BALANCE" });
    // Classified, never echoed: upstream text can carry the key or the balance.
    expect(refusal.message).not.toMatch(/provider-secret|not enough funds/i);

    // A credential complaint stays an outage even when it mentions a balance.
    refuse({ success: false, message: "Invalid API key. Balance: 0" }, 200);
    await expect(listFleexaSmsServices()).rejects.toMatchObject({ status: 502, code: "UPSTREAM_ERROR" });
  });

  it("handles nested listing shapes, explicit country codes and bounded, sanitized errors", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { apps: [{ serviceName: "Signal", country_code: "US", price: 500, stock: 4 }, { serviceName: "Other", country_code: "US", price: "", stock: "  " }] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { areas: [{ id: "area", country_code: "GB", name: "London", monthly_price: 500, stock: 2 }] } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "provider-secret" }), { status: 400 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200, headers: { "content-length": "1048577" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { unexpected: "shape" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await listFleexaSmsServices()).toEqual([
      { id: "Signal", name: "Signal", country: "US", priceNgn: 500, stock: 4 },
      { id: "Other", name: "Other", country: "US", priceNgn: null, stock: null },
    ]);
    expect((await listFleexaRentAreas())[0]).toMatchObject({ country: "GB" });
    await expect(listFleexaSmsServices()).rejects.toMatchObject({ message: "Provider request failed", code: "UPSTREAM_ERROR" });
    await expect(listFleexaSmsServices()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(listFleexaSmsServices()).rejects.toMatchObject({ code: "INVALID_CATALOG" });
  });
});
