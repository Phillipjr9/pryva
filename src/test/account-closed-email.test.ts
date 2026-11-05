import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  preview: false,
  configured: true,
  after: vi.fn(),
  fetch: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/platform/demo-policy", () => ({ isPreviewDatabase: () => mocks.preview }));
vi.mock("@/lib/email/resend-config", () => ({ resendConfigured: () => mocks.configured }));
vi.mock("@/lib/platform/logger", () => ({ logger: mocks.log }));

import { buildAccountClosedEmail, scheduleAccountClosedEmail, sendAccountClosedEmail } from "@/lib/email/account-closed-email";

const when = new Date("2026-11-05T12:30:00Z");
const input = { to: "former-owner@example.test", when };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.preview = false;
  mocks.configured = true;
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pryvalogs.com");
  vi.stubEnv("RESEND_API_KEY", "re_preview_test");
  vi.stubEnv("RESEND_FROM_EMAIL", "Pryva <mail@example.test>");
  mocks.fetch.mockImplementation(async () => new Response(JSON.stringify({ id: "accepted" }), { status: 200 }));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("account closure notice", () => {
  it("uses dedicated artwork, a public contact link and no private account details", () => {
    const notice = buildAccountClosedEmail(when);
    expect(notice.subject).toMatch(/account was closed/i);
    expect(notice.html).toContain("https://pryvalogs.com/images/email/hero-account-closed.jpg");
    expect(notice.html).toContain('href="https://pryvalogs.com/contact"');
    expect(notice.text).toContain("2026-11-05 12:30 UTC");
    expect(notice.text).toMatch(/if you did not request this/i);
    expect(notice.text + notice.html).not.toMatch(/dashboard|account number|wallet balance|former-owner@example\.test/i);
  });

  it("sends once with a bounded request only after the scheduled callback runs", async () => {
    scheduleAccountClosedEmail(input);
    expect(mocks.after).toHaveBeenCalledOnce();
    expect(mocks.fetch).not.toHaveBeenCalled();
    const callback = mocks.after.mock.calls[0][0] as () => Promise<void>;
    await callback();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init).toMatchObject({ redirect: "error", cache: "no-store", method: "POST", signal: expect.any(AbortSignal) });
    expect(JSON.parse(String(init.body))).toMatchObject({ to: [input.to], subject: "Your Pryva account was closed" });
    expect(JSON.stringify(mocks.log)).not.toContain(input.to);
  });

  it("does not contact a mail provider in the in-memory preview", () => {
    mocks.preview = true;
    scheduleAccountClosedEmail(input);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("does not throw or retry if scheduling or the provider fails", async () => {
    mocks.after.mockImplementationOnce(() => { throw new Error(input.to); });
    expect(() => scheduleAccountClosedEmail(input)).not.toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.fetch.mockRejectedValueOnce(new Error(`could not send to ${input.to}`));
    await expect(sendAccountClosedEmail(input)).resolves.toBe(false);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.log.warn.mock.calls)).not.toContain(input.to);
  });

  it("does not claim a send when mail is unconfigured, refused, or acceptance lacks an ID", async () => {
    mocks.configured = false;
    expect(await sendAccountClosedEmail(input)).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.configured = true;
    mocks.fetch.mockResolvedValueOnce(new Response("rejected", { status: 403 }));
    expect(await sendAccountClosedEmail(input)).toBe(false);
    mocks.fetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    expect(await sendAccountClosedEmail(input)).toBe(false);
  });

  it("rejects malformed recipients or dates without contacting a provider", async () => {
    expect(await sendAccountClosedEmail({ ...input, to: "x@example.test\r\nBcc: z@example.test" })).toBe(false);
    expect(await sendAccountClosedEmail({ ...input, when: new Date("invalid") })).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
