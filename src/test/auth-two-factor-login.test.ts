import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The promise two-factor authentication makes is that a correct password alone
 * stops being enough. These tests hold the login route to it: with an enrolment
 * enabled it must issue a challenge, and when the server cannot check the second
 * factor it must issue nothing at all — not a session with the second step
 * quietly skipped.
 */

const mocks = vi.hoisted(() => {
  const user = {
    id: "user-1",
    email: "ada@pryva.ng",
    passwordHash: "stored-hash",
  };
  return {
    user,
    check: vi.fn(),
    clear: vi.fn(),
    session: vi.fn(),
    enrolment: vi.fn(),
    challenge: vi.fn(),
    available: vi.fn(),
  };
});

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [mocks.user],
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/auth", () => ({
  createSession: mocks.session,
  verifyPassword: () => true,
  hashPassword: () => "hash",
  isValidEmail: (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email),
  normalizeEmail: (email: string) => email.trim().toLowerCase(),
  isConfiguredAdminEmail: () => false,
}));

vi.mock("@/lib/auth-rate-limit", () => ({
  checkAuthRateLimit: mocks.check,
  clearAuthRateLimit: mocks.clear,
}));

vi.mock("@/lib/two-factor", () => ({
  CHALLENGE_TTL_MS: 5 * 60 * 1000,
  getEnrolment: mocks.enrolment,
  createChallenge: mocks.challenge,
  twoFactorAvailable: mocks.available,
}));

import { POST } from "@/app/api/auth/login/route";

function request() {
  return new Request("https://pryva.test/api/auth/login", {
    method: "POST",
    headers: {
      host: "pryva.test",
      "x-forwarded-proto": "https",
      origin: "https://pryva.test",
      "content-type": "application/json",
    },
    body: JSON.stringify({ email: "ada@pryva.ng", password: "correct horse battery staple" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.check.mockResolvedValue(null);
  mocks.challenge.mockResolvedValue({ token: "challenge-token", expiresAt: new Date() });
});

describe("login with a second factor enabled", () => {
  it("returns a challenge instead of a session", async () => {
    mocks.enrolment.mockResolvedValue({ enabledAt: new Date(), secret: "JBSWY3DP" });
    mocks.available.mockReturnValue(true);

    const response = await POST(request());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, twoFactorRequired: true, challengeToken: "challenge-token" });
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalled();
  });

  it("fails closed with 503 and no challenge when the key is missing", async () => {
    mocks.enrolment.mockResolvedValue({ enabledAt: new Date(), secret: "" });
    mocks.available.mockReturnValue(false);

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(mocks.challenge).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("still signs in an account that has not enrolled", async () => {
    mocks.enrolment.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.session).toHaveBeenCalledWith(mocks.user.id, expect.anything());
  });
});
