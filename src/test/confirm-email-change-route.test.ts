import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The endpoint the confirmation link lands on.
 *
 * Two things must hold: an unusable link changes nothing, and a mail outage
 * after a successful change does not tell the customer the change failed.
 */

const state = vi.hoisted(() => ({
  sameOrigin: true,
  throttle: { allowed: true, unavailable: false },
  confirm: vi.fn(),
  notice: vi.fn(),
}));

vi.mock("@/lib/net", () => ({ isSameOriginMutation: () => state.sameOrigin }));
vi.mock("@/lib/rate-limit", () => ({ authRateLimiter: async () => state.throttle }));
vi.mock("@/lib/email-change", () => ({ confirmEmailChange: (...args: unknown[]) => state.confirm(...args) }));
vi.mock("@/lib/security-notice", () => ({ sendSecurityNotice: (...args: unknown[]) => state.notice(...args) }));

import { POST } from "@/app/api/auth/confirm-email-change/route";

function request(body: unknown = { token: "token-value" }) {
  return new NextRequest("https://pryva.test/api/auth/confirm-email-change", {
    method: "POST",
    headers: { origin: "https://pryva.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.sameOrigin = true;
  state.throttle = { allowed: true, unavailable: false };
  state.confirm.mockResolvedValue({ ok: true, email: "new@example.com", previousEmail: "old@example.com" });
  state.notice.mockResolvedValue({ sent: true, detail: null });
});

describe("POST /api/auth/confirm-email-change", () => {
  it("applies the change and tells the old address", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, email: "new@example.com" });
    expect(state.confirm).toHaveBeenCalledWith("token-value");
    expect(state.notice).toHaveBeenCalledWith({ to: "old@example.com", name: "", event: "email_changed" });
  });

  it("still reports success when the notice cannot be sent", async () => {
    state.notice.mockRejectedValue(new Error("resend down"));
    const response = await POST(request());
    expect(response.status).toBe(200);
  });

  it("rejects an unusable link", async () => {
    state.confirm.mockResolvedValue({ ok: false, error: "That link is no longer valid. Start the change again." });
    const response = await POST(request());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: /no longer valid/i });
    expect(state.notice).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin post", async () => {
    state.sameOrigin = false;
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(state.confirm).not.toHaveBeenCalled();
  });

  it("refuses a body without a token", async () => {
    const response = await POST(request({ token: 42 }));
    expect(response.status).toBe(400);
    expect(state.confirm).not.toHaveBeenCalled();
  });
});
