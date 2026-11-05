import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Something changed on your account."
 *
 * These notices are worth nothing if they are allowed to break the thing that
 * triggered them: a password change that commits and then reports failure
 * because Resend is down leaves the customer convinced their old password still
 * works. So the contract tested here is two-sided — say the right thing to the
 * right address, and never throw.
 */

const state = vi.hoisted(() => ({ configured: true, fetch: vi.fn() }));

vi.mock("@/lib/resend-config", () => ({ resendConfigured: () => state.configured }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { buildSecurityNotice, sendSecurityNotice } from "@/lib/security-notice";

function sentBody() {
  return JSON.parse(state.fetch.mock.calls.at(-1)![1].body as string) as {
    to: string[];
    subject: string;
    html: string;
    text: string;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.configured = true;
  state.fetch.mockImplementation(async () => new Response(JSON.stringify({ id: "message-1" }), { status: 200 }));
  vi.stubGlobal("fetch", state.fetch);
  process.env.RESEND_API_KEY = "re_test";
  process.env.RESEND_FROM_EMAIL = "Pryva <hello@pryva.ng>";
});

describe("the four things worth an email", () => {
  it("tells the owner a password change signed everything else out", () => {
    const notice = buildSecurityNotice("password_changed", "Ada", new Date("2026-03-04T09:05:00Z"));
    expect(notice.subject).toMatch(/password was changed/i);
    expect(notice.text).toContain("Hi Ada");
    expect(notice.text).toMatch(/every other session was signed out/i);
    expect(notice.text).toContain("2026-03-04 09:05 UTC");
  });

  it("tells the old address it is no longer the way in", () => {
    const notice = buildSecurityNotice("email_changed", "Ada", new Date());
    expect(notice.subject).toMatch(/sign-in email was changed/i);
    expect(notice.text).toMatch(/no longer the one used to sign in/i);
    expect(notice.text).toMatch(/contact support immediately/i);
    expect(notice.html).toContain('/contact"');
    expect(notice.html).not.toContain('/forgot-password');
  });

  it("distinguishes two-factor being switched on from switched off", () => {
    const on = buildSecurityNotice("two_factor_enabled", "Ada", new Date());
    const off = buildSecurityNotice("two_factor_disabled", "Ada", new Date());
    expect(on.text).toMatch(/needs a code from your authenticator/i);
    expect(off.text).toMatch(/authenticator code is no longer required/i);
    expect(on.subject).not.toBe(off.subject);
  });

  it("uses different artwork for each security event", () => {
    const at = new Date("2026-03-04T09:05:00Z");
    const expected = {
      password_changed: "password-changed",
      email_changed: "email-changed",
      two_factor_enabled: "two-factor-on",
      two_factor_disabled: "two-factor-off",
      passkey_added: "passkey-added",
      passkey_removed: "passkey-removed",
    } as const;
    for (const [event, hero] of Object.entries(expected)) {
      const notice = buildSecurityNotice(event as keyof typeof expected, "Ada", at);
      expect(notice.html).toContain(`/images/email/hero-${hero}.jpg`);
      expect(notice.html).toContain('alt="');
    }
  });

  it("escapes a name that looks like markup", () => {
    const notice = buildSecurityNotice("password_changed", "<b>Ada</b>", new Date());
    expect(notice.html).toContain("&lt;b&gt;Ada&lt;/b&gt;");
    expect(notice.html).not.toContain("<b>Ada</b>");
  });
});

describe("sending it", () => {
  it("posts to the address it was given, once", async () => {
    const result = await sendSecurityNotice({ to: "ada@example.com", name: "Ada", event: "two_factor_disabled" });
    expect(result).toEqual({ sent: true, detail: null });
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(state.fetch.mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store" });
    expect(sentBody().to).toEqual(["ada@example.com"]);
    expect(sentBody().subject).toMatch(/turned off/i);
  });

  it("does nothing, and says why, when mail is not configured", async () => {
    state.configured = false;
    const result = await sendSecurityNotice({ to: "ada@example.com", name: "Ada", event: "password_changed" });
    expect(result).toEqual({ sent: false, detail: "mail not configured" });
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("refuses a recipient that is not an address", async () => {
    for (const bad of ["", "ada", "ada@example.com\r\nBcc: evil@example.com", "a@b"]) {
      const result = await sendSecurityNotice({ to: bad, name: "Ada", event: "password_changed" });
      expect(result.sent).toBe(false);
    }
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("reports a refused send without throwing", async () => {
    state.fetch.mockResolvedValue({ ok: false, status: 403 });
    const result = await sendSecurityNotice({ to: "ada@example.com", name: "Ada", event: "password_changed" });
    expect(result).toEqual({ sent: false, detail: "provider 403" });
  });

  it("does not claim acceptance when a successful response has no provider message ID", async () => {
    state.fetch.mockImplementation(async () => new Response("{}", { status: 200 }));
    const result = await sendSecurityNotice({ to: "ada@example.com", name: "Ada", event: "two_factor_enabled" });
    expect(result).toEqual({ sent: false, detail: "acceptance unconfirmed" });
  });

  it("swallows a network failure, so the action that triggered it still succeeds", async () => {
    state.fetch.mockRejectedValue(new Error("socket hang up"));
    await expect(
      sendSecurityNotice({ to: "ada@example.com", name: "Ada", event: "password_changed" }),
    ).resolves.toEqual({ sent: false, detail: "send failed" });
  });

  it("swallows a timeout too", async () => {
    state.fetch.mockRejectedValue(new DOMException("The operation was aborted.", "TimeoutError"));
    await expect(
      sendSecurityNotice({ to: "ada@example.com", name: "Ada", event: "email_changed" }),
    ).resolves.toMatchObject({ sent: false });
  });
});
