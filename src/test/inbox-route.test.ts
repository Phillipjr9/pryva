import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The free-inbox endpoint.
 *
 * Two failures here were invisible from outside: one shared "not available in
 * this environment" answer covering two unrelated causes, and a per-connection
 * allowance that a *failed* attempt still consumed — so pressing a broken button
 * three times locked the feature out for a day. Both are pinned below.
 */

const state = vi.hoisted(() => ({
  preview: false,
  configured: true,
  limit: { allowed: true, unavailable: false },
  create: vi.fn(),
  release: vi.fn(),
  sameOrigin: true,
  inboxes: [] as unknown[],
}));

vi.mock("@/lib/auth", () => ({ requireAuthApi: async () => ({ id: "u1", email: "ada@example.com" }) }));
vi.mock("@/lib/net", () => ({ isSameOriginMutation: () => state.sameOrigin }));
vi.mock("@/lib/demo-policy", () => ({ isPreviewDatabase: () => state.preview }));
vi.mock("@/lib/fleexa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fleexa")>();
  return { ...actual, isFleexaConfigured: () => state.configured };
});
vi.mock("@/lib/auth-rate-limit", () => ({ clientIp: () => "203.0.113.9" }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    apiRateLimiter: async () => state.limit,
    inboxCreateIpRateLimiter: async () => state.limit,
    releaseRateLimit: (key: string) => state.release(key),
  };
});
vi.mock("@/lib/request-body", () => ({
  readJsonWithLimit: async () => ({}),
  RequestBodyTooLargeError: class extends Error {},
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/disposable-inbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/disposable-inbox")>();
  return {
    ...actual,
    createFreeInbox: (...args: unknown[]) => state.create(...args),
    listInboxes: async () => state.inboxes,
  };
});

import { GET, POST } from "@/app/api/inbox/route";
import { FleexaError } from "@/lib/fleexa";

function request() {
  return new NextRequest(new URL("https://pryva.test/api/inbox"), {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://pryva.test" },
    body: "{}",
  });
}

beforeEach(() => {
  state.preview = false;
  state.configured = true;
  state.limit = { allowed: true, unavailable: false };
  state.sameOrigin = true;
  state.inboxes = [];
  state.create.mockReset();
  state.release.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/inbox", () => {
  it("creates the inbox", async () => {
    state.create.mockResolvedValue({ id: "inbox-1", address: "a@b.test", tier: "free", status: "active" });
    const response = await POST(request());
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });

  it("says which deployment is refusing, instead of one sentence for both", async () => {
    state.preview = true;
    const preview = await POST(request());
    expect(preview.status).toBe(503);
    await expect(preview.json()).resolves.toMatchObject({ code: "PREVIEW" });

    state.preview = false;
    state.configured = false;
    const unconfigured = await POST(request());
    expect(unconfigured.status).toBe(503);
    await expect(unconfigured.json()).resolves.toMatchObject({ code: "NOT_CONFIGURED" });
  });

  it("gives the attempt back when the feed refused and nothing was bought", async () => {
    state.create.mockRejectedValue(new FleexaError("Provider request failed", 502, "UPSTREAM_ERROR"));

    const response = await POST(request());

    expect(response.status).toBe(502);
    expect(state.release).toHaveBeenCalledWith("inbox-create:ip:203.0.113.9");
  });

  it("keeps the attempt when the outcome is ambiguous, because money may have moved", async () => {
    state.create.mockRejectedValue(new FleexaError("no answer", 502, "UPSTREAM_UNREACHABLE"));

    const response = await POST(request());

    expect(response.status).toBe(502);
    expect(state.release).not.toHaveBeenCalled();
  });

  it("gives the attempt back when the customer's own daily limit refused it", async () => {
    const { InboxError } = await import("@/lib/disposable-inbox");
    state.create.mockRejectedValue(new InboxError("DAILY_LIMIT", 429, "used today"));

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(state.release).toHaveBeenCalled();
  });

  it("keeps the connection ceiling for a caller who is over it", async () => {
    state.limit = { allowed: false, unavailable: false };
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(state.create).not.toHaveBeenCalled();
    expect(state.release).not.toHaveBeenCalled();
  });

  it("does not release anything for a cross-origin request that never ran", async () => {
    state.sameOrigin = false;
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(state.release).not.toHaveBeenCalled();
  });
});

describe("GET /api/inbox", () => {
  it("names the reason the feature is off, so the page can say something useful", async () => {
    state.configured = false;
    const response = await GET();
    await expect(response.json()).resolves.toMatchObject({ configured: false, reason: "not_configured" });

    state.configured = true;
    state.preview = true;
    const preview = await GET();
    await expect(preview.json()).resolves.toMatchObject({ configured: false, reason: "preview" });
  });

  it("reports the feature as on when both gates are open", async () => {
    const response = await GET();
    await expect(response.json()).resolves.toMatchObject({ configured: true, reason: null });
  });
});
