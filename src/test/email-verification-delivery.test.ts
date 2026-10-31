import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Whether the verification mail was actually accepted.
 *
 * The send used to return `void` and never read the provider's answer, so a
 * refused message looked exactly like a delivered one. That is how a person could
 * press "Email me a link", see nothing, and be told — by the route — that a link
 * was on its way. These tests make the answer observable.
 */

const writes = vi.hoisted(() => ({ updates: 0, inserts: 0 }));

vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: () => ({
        where: () => {
          writes.updates += 1;
          return Promise.resolve();
        },
      }),
    }),
    insert: () => ({
      values: () => {
        writes.inserts += 1;
        return Promise.resolve();
      },
    }),
  },
}));

import { issueEmailVerification } from "@/lib/email-verification";

function stubProvider(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  writes.updates = 0;
  writes.inserts = 0;
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("RESEND_FROM_EMAIL", "onboarding@resend.dev");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("issuing a verification link", () => {
  it("reports success only when the message was accepted", async () => {
    stubProvider(200, { id: "msg_1" });
    await expect(issueEmailVerification("u1", "ada@example.com", "Ada")).resolves.toEqual({
      delivered: true,
      detail: null,
    });
  });

  it("stores the token before it tries to send, so a failed send is retryable", async () => {
    stubProvider(500, {});
    await issueEmailVerification("u1", "ada@example.com", "Ada");
    expect(writes.updates).toBe(1); // earlier tokens superseded
    expect(writes.inserts).toBe(1); // the new one exists regardless
  });

  it("surfaces the provider's own refusal instead of swallowing it", async () => {
    stubProvider(403, {
      statusCode: 403,
      message: "You can only send testing emails to your own email address.",
    });

    const result = await issueEmailVerification("u1", "ada@example.com", "Ada");

    expect(result.delivered).toBe(false);
    expect(result.detail).toContain("403");
    expect(result.detail).toContain("testing emails");
  });

  it("keeps a refusal readable when the provider answers with plain text", async () => {
    stubProvider(422, "domain is not verified");
    const result = await issueEmailVerification("u1", "ada@example.com", "Ada");
    expect(result.delivered).toBe(false);
    expect(result.detail).toMatch(/refused/i);
  });

  it("reports an unreachable provider as undelivered, not as sent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket hang up")));
    const result = await issueEmailVerification("u1", "ada@example.com", "Ada");
    expect(result).toEqual({ delivered: false, detail: "the mail service could not be reached" });
  });

  it("says mail is not configured rather than claiming a send", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const result = await issueEmailVerification("u1", "ada@example.com", "Ada");
    expect(result.delivered).toBe(false);
    expect(result.detail).toContain("not configured");
  });
});
