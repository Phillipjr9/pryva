import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Asking for a change of address from the settings page.
 *
 * The endpoint reports the server's verdict honestly — a refused send is a 502,
 * a rate limit is a 429 — because "we've sent you a link" when nothing was sent
 * is the exact confusion this flow exists to remove.
 */

const state = vi.hoisted(() => ({
  user: { id: "u1", email: "ada@example.com", name: "Ada" } as
    | { id: string; email: string; name: string }
    | null,
  sameOrigin: true,
  throttle: { allowed: true, unavailable: false },
  request: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuthApi: async () => state.user }));
vi.mock("@/lib/net", () => ({ isSameOriginMutation: () => state.sameOrigin }));
vi.mock("@/lib/rate-limit", () => ({ authRateLimiter: async () => state.throttle }));
vi.mock("@/lib/email-change", () => ({ requestEmailChange: (...args: unknown[]) => state.request(...args) }));

import { POST } from "@/app/api/user/email/route";

function request(body: unknown = { email: "new@example.com" }) {
  return new NextRequest("https://pryva.test/api/user/email", {
    method: "POST",
    headers: { origin: "https://pryva.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: "u1", email: "ada@example.com", name: "Ada" };
  state.sameOrigin = true;
  state.throttle = { allowed: true, unavailable: false };
  state.request.mockResolvedValue({ ok: true, message: "Check the new address for a link to confirm it." });
});

describe("POST /api/user/email", () => {
  it("passes the signed-in account and the requested address to the flow", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, message: expect.stringMatching(/check the new address/i) });
    expect(state.request).toHaveBeenCalledWith({ userId: "u1", newEmail: "new@example.com" });
  });

  it("rejects a signed-out caller", async () => {
    state.user = null;
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(state.request).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin post", async () => {
    state.sameOrigin = false;
    expect((await POST(request())).status).toBe(403);
  });

  it("rate limits repeated attempts", async () => {
    state.throttle = { allowed: false, unavailable: false };
    expect((await POST(request())).status).toBe(429);
    state.throttle = { allowed: false, unavailable: true };
    expect((await POST(request())).status).toBe(503);
  });

  it("passes the flow's own refusals through with their status", async () => {
    state.request.mockResolvedValue({ ok: false, error: "That address is already in use.", status: 409 });
    const response = await POST(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: /already in use/i });
  });

  it("rejects a body that is not an address", async () => {
    const response = await POST(request({ email: 12 }));
    expect(response.status).toBe(400);
    expect(state.request).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON body", async () => {
    const response = await POST(
      new NextRequest("https://pryva.test/api/user/email", {
        method: "POST",
        headers: { origin: "https://pryva.test", "content-type": "text/plain" },
        body: "email=new@example.com",
      }),
    );
    expect(response.status).toBe(415);
  });
});
