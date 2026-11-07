import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TURNSTILE_MESSAGES,
  isTurnstileConfigured,
  turnstileSiteKey,
  verifyTurnstileToken,
} from "@/lib/platform/turnstile";

/**
 * The signup bot challenge.
 *
 * Two failure modes matter and they pull in opposite directions. Enforcing
 * before the owner has created a widget locks every customer out of signup; not
 * enforcing once the widget exists lets every bot through. These tests pin the
 * boundary between them, and pin that a Cloudflare outage is a "try again" rather
 * than an open door — falling open on a network error would let an attacker skip
 * the challenge simply by breaking our verification call.
 */

const BOTH = {
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAA_site",
  TURNSTILE_SECRET_KEY: "0x4AAAAAAA_secret",
};

const fetchMock = vi.fn();

function siteverify(body: unknown, ok = true, status = 200) {
  fetchMock.mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Turnstile configuration", () => {
  it("needs both halves, not either one", () => {
    expect(isTurnstileConfigured(BOTH)).toBe(true);
    expect(isTurnstileConfigured({})).toBe(false);
    // A site key with no secret is the dangerous half-state: the widget renders
    // and nobody checks the token it produces.
    expect(isTurnstileConfigured({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site" })).toBe(false);
    expect(isTurnstileConfigured({ TURNSTILE_SECRET_KEY: "secret" })).toBe(false);
  });

  it("treats blank and whitespace-only values as unset", () => {
    expect(turnstileSiteKey({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "   " })).toBeNull();
    expect(turnstileSiteKey({})).toBeNull();
    expect(turnstileSiteKey({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "  key  " })).toBe("key");
    expect(isTurnstileConfigured({
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site",
      TURNSTILE_SECRET_KEY: "  ",
    })).toBe(false);
  });
});

describe("verifyTurnstileToken", () => {
  it("does not challenge anybody before the widget is configured", async () => {
    // Shipping this code must not break signup on a deployment with no keys.
    await expect(verifyTurnstileToken(undefined, "1.2.3.4", {})).resolves.toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a missing, empty or non-string token once configured", async () => {
    for (const token of [undefined, null, "", 42, {}, []]) {
      await expect(verifyTurnstileToken(token, null, BOTH)).resolves.toEqual({ ok: false, reason: "missing" });
    }
    // Nothing is spent on Cloudflare for a request that carries no token.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an absurdly long token without sending it", async () => {
    await expect(verifyTurnstileToken("x".repeat(4_000), null, BOTH)).resolves.toEqual({ ok: false, reason: "missing" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a token Cloudflare confirms", async () => {
    siteverify({ success: true });
    await expect(verifyTurnstileToken("token-abc", "203.0.113.9", BOTH)).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init.method).toBe("POST");
    const sent = new URLSearchParams(init.body as URLSearchParams);
    expect(sent.get("secret")).toBe("0x4AAAAAAA_secret");
    expect(sent.get("response")).toBe("token-abc");
    expect(sent.get("remoteip")).toBe("203.0.113.9");
  });

  it("omits an unknown client IP rather than sending the placeholder", async () => {
    siteverify({ success: true });
    await verifyTurnstileToken("token-abc", "unknown", BOTH);
    const sent = new URLSearchParams(fetchMock.mock.calls[0][1].body as URLSearchParams);
    expect(sent.has("remoteip")).toBe(false);
  });

  it("refuses a token Cloudflare rejects, including a replayed one", async () => {
    // Cloudflare tokens are single use; a replay comes back as a duplicate.
    siteverify({ success: false, "error-codes": ["timeout-or-duplicate"] });
    await expect(verifyTurnstileToken("spent", null, BOTH)).resolves.toEqual({ ok: false, reason: "rejected" });

    siteverify({ success: false, "error-codes": ["invalid-input-response"] });
    await expect(verifyTurnstileToken("forged", null, BOTH)).resolves.toEqual({ ok: false, reason: "rejected" });
  });

  it("does not read a malformed success body as a pass", async () => {
    siteverify({});
    await expect(verifyTurnstileToken("token", null, BOTH)).resolves.toEqual({ ok: false, reason: "rejected" });
    siteverify({ success: "true" });
    await expect(verifyTurnstileToken("token", null, BOTH)).resolves.toEqual({ ok: false, reason: "rejected" });
  });

  it("fails closed when Cloudflare cannot be reached", async () => {
    fetchMock.mockRejectedValue(new Error("socket hang up"));
    await expect(verifyTurnstileToken("token", null, BOTH)).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("fails closed on a Cloudflare 5xx", async () => {
    siteverify({}, false, 503);
    await expect(verifyTurnstileToken("token", null, BOTH)).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("fails closed when the response body cannot be read", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } });
    await expect(verifyTurnstileToken("token", null, BOTH)).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("bounds the call so a hung provider cannot hold the signup request open", async () => {
    siteverify({ success: true });
    await verifyTurnstileToken("token", null, BOTH);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe("what the customer is told", () => {
  it("has a message for every refusal, and none of them names the check", () => {
    for (const reason of ["missing", "rejected", "unavailable"] as const) {
      const message = TURNSTILE_MESSAGES[reason];
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/turnstile|cloudflare|honeypot|secret/i);
    }
  });
});
