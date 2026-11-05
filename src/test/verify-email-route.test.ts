import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The resend endpoint's answer.
 *
 * It used to return ok as soon as a token existed, even when the provider had
 * refused the message — the reason nothing appeared to happen was partly the page,
 * and partly this: the server was promising a send it never checked. Now a
 * refused send is a 502 with the reason, and success is only success.
 */

const state = vi.hoisted(() => ({
  user: { id: "u1", email: "ada@example.com", name: "Ada", emailVerifiedAt: null as Date | null },
  throttle: { allowed: true, unavailable: false },
  configured: true,
  delivery: { delivered: true, detail: null as string | null },
  issue: vi.fn(),
  onboarding: vi.fn(),
  sameOrigin: true,
}));

vi.mock("@/lib/identity/auth", () => ({ requireAuthApi: async () => state.user }));
vi.mock("@/lib/platform/net", () => ({ isSameOriginMutation: () => state.sameOrigin }));
vi.mock("@/lib/email/resend-config", () => ({ resendConfigured: () => state.configured }));
vi.mock("@/lib/identity/email-verification", () => ({
  rateLimitEmailVerification: async () => state.throttle,
  issueEmailVerification: (...args: unknown[]) => {
    state.issue(...args);
    return Promise.resolve(state.delivery);
  },
}));
vi.mock("@/lib/platform/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/email/onboarding-emails", () => ({
  scheduleOnboardingEmails: (...args: unknown[]) => {
    state.onboarding(...args);
  },
}));

import { POST } from "@/app/api/auth/verify-email/route";

function request() {
  return new NextRequest(new URL("https://pryva.test/api/auth/verify-email"), {
    method: "POST",
    headers: { origin: "https://pryva.test" },
  });
}

beforeEach(() => {
  state.user = { id: "u1", email: "ada@example.com", name: "Ada", emailVerifiedAt: null };
  state.throttle = { allowed: true, unavailable: false };
  state.configured = true;
  state.delivery = { delivered: true, detail: null };
  state.sameOrigin = true;
  state.issue.mockReset();
  state.onboarding.mockReset();
});

describe("POST /api/auth/verify-email", () => {
  it("confirms when the message was accepted", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, delivered: true });
    expect(state.issue).toHaveBeenCalledWith("u1", "ada@example.com", "Ada");
  });

  it("refuses to claim success when delivery was rejected", async () => {
    state.delivery = { delivered: false, detail: "the mail service refused the message (403)" };

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.delivered).toBe(false);
    expect(body.error).toContain("403");
    expect(body.error).toMatch(/check your inbox/i);
  });

  it("says mail is not configured before it issues anything", async () => {
    state.configured = false;
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(state.issue).not.toHaveBeenCalled();
  });

  it("does not send a second link to an already verified address", async () => {
    state.user.emailVerifiedAt = new Date();
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, alreadyVerified: true });
    expect(state.issue).not.toHaveBeenCalled();
  });

  it("repairs a missing receipt and welcome for an account that is already verified", async () => {
    // The only screen a verified customer returns to. Somebody whose onboarding
    // emails were lost to an outage or a missing table ends up here; the reply is
    // still "already verified", but the two missing emails are re-attempted. The
    // unique index on (user_id, kind) makes a duplicate impossible, so this is
    // safe to do on every press.
    state.user.emailVerifiedAt = new Date();
    await POST(request());
    expect(state.onboarding).toHaveBeenCalledWith("u1");
  });

  it("does not touch onboarding emails when a fresh link is being issued", async () => {
    // The account is not verified yet, so there is no milestone to report and no
    // welcome to send; the link is the only thing that should go out.
    await POST(request());
    expect(state.onboarding).not.toHaveBeenCalled();
  });

  it("keeps the cross-origin and throttle refusals", async () => {
    state.sameOrigin = false;
    expect((await POST(request())).status).toBe(403);

    state.sameOrigin = true;
    state.throttle = { allowed: false, unavailable: false };
    expect((await POST(request())).status).toBe(429);
    expect(state.issue).not.toHaveBeenCalled();
  });
});
