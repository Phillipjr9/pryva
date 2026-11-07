import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Signup bot protection, end to end at the source level plus the operator alert's
 * behaviour.
 *
 * The problem being fixed was two problems wearing one costume. Bots could
 * create accounts because nothing challenged them, and every attempt emailed the
 * owner — so the owner's own application was the source of the "spam" they were
 * reporting. The fix has to hold on both sides: a challenge before the row is
 * written, and silence until an address is proven.
 */

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  alert: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => mocks.rows,
        }),
      }),
    }),
  },
}));
vi.mock("@/lib/email/contact-message-email", () => ({
  sendNewUserSignupAlert: mocks.alert,
}));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));

import { scheduleVerifiedSignupAlert, sendVerifiedSignupAlert } from "@/lib/email/signup-alert";

const read = (path: string) => readFileSync(path, "utf8");
const signupRoute = read("src/app/api/auth/signup/route.ts");
const confirmRoute = read("src/app/api/auth/verify-email/confirm/route.ts");
const googleCallback = read("src/app/api/auth/google/callback/route.ts");
const verification = read("src/lib/identity/email-verification.ts");
const authForm = read("src/components/auth/AuthForm.tsx");
const signupPage = read("src/app/(auth)/signup/page.tsx");
const widget = read("src/components/auth/TurnstileWidget.tsx");
const envExample = read(".env.example");
const proxy = read("src/proxy.ts");

const VERIFIED_USER = {
  name: "Adaeze Okafor",
  email: "adaeze@example.test",
  createdAt: new Date("2026-01-04T10:00:00Z"),
  deletedAt: null,
  emailVerifiedAt: new Date("2026-01-04T10:05:00Z"),
};

beforeEach(() => {
  mocks.rows = [{ ...VERIFIED_USER }];
  mocks.alert.mockReset();
  mocks.alert.mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the operator alert fires on proof, not on a form post", () => {
  it("is gone from signup entirely", () => {
    // This is the line that mailed the owner once per bot.
    expect(signupRoute).not.toContain("sendNewUserSignupAlert");
    expect(signupRoute).not.toContain("pending_verification");
  });

  it("fires when the verification link is clicked", () => {
    expect(confirmRoute).toContain("scheduleVerifiedSignupAlert(result.userId)");
  });

  it("fires only on the first verification, so a stray second token is silent", () => {
    expect(confirmRoute).toMatch(/if \(result\.firstVerification\) scheduleVerifiedSignupAlert/);
    // The flag has to come from a row that actually changed, not from the token
    // being valid — a resend leaves a second live token behind.
    expect(verification).toContain("firstVerification: verifiedNow");
    expect(verification).toMatch(/\.returning\(\{ id: users\.id \}\)/);
    expect(verification).toContain("return updated.length > 0;");
  });

  it("fires for a Google signup, which is verified at creation", () => {
    // Otherwise the operator would hear about every email signup and no Google
    // ones — a quieter inbox that is also missing customers.
    expect(googleCallback).toContain("scheduleVerifiedSignupAlert(created.id)");
  });

  it("sends the verified status and the real account details", async () => {
    await expect(sendVerifiedSignupAlert("user-1")).resolves.toBe(true);
    expect(mocks.alert).toHaveBeenCalledTimes(1);
    expect(mocks.alert.mock.calls[0][0]).toEqual({
      name: VERIFIED_USER.name,
      email: VERIFIED_USER.email,
      createdAt: VERIFIED_USER.createdAt,
      status: "verified",
    });
  });

  it("stays silent for an account that no longer exists", async () => {
    mocks.rows = [];
    await expect(sendVerifiedSignupAlert("gone")).resolves.toBe(false);
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it("stays silent for a closed account", async () => {
    mocks.rows = [{ ...VERIFIED_USER, deletedAt: new Date() }];
    await expect(sendVerifiedSignupAlert("closed")).resolves.toBe(false);
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it("stays silent for an unverified account, which is the whole point", async () => {
    mocks.rows = [{ ...VERIFIED_USER, emailVerifiedAt: null }];
    await expect(sendVerifiedSignupAlert("bot")).resolves.toBe(false);
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it("never lets a mail failure surface as a failed verification", async () => {
    mocks.alert.mockRejectedValue(new Error("resend down"));
    expect(() => scheduleVerifiedSignupAlert("user-1")).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });
});

describe("signup refuses automation before it writes an account", () => {
  it("verifies the challenge before the insert, not after", () => {
    const check = signupRoute.indexOf("verifyTurnstileToken(fields.captchaToken");
    const insert = signupRoute.indexOf("db.insert(users)");
    expect(check).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(check);
  });

  it("does not spend a Cloudflare call on a body that was already invalid", () => {
    const passwordCheck = signupRoute.indexOf("Use a password between 8 and 128 characters.");
    const challenge = signupRoute.indexOf("verifyTurnstileToken(");
    expect(passwordCheck).toBeGreaterThan(-1);
    expect(challenge).toBeGreaterThan(passwordCheck);
  });

  it("answers a refused challenge with 400 and an outage with 503", () => {
    expect(signupRoute).toContain('challenge.reason === "unavailable" ? 503 : 400');
    expect(signupRoute).toContain("TURNSTILE_MESSAGES[challenge.reason]");
  });

  it("passes the caller's IP so a token cannot be farmed elsewhere", () => {
    expect(signupRoute).toContain("verifyTurnstileToken(fields.captchaToken, clientIp(request))");
  });

  it("keeps the existing defences rather than replacing them", () => {
    expect(signupRoute).toContain('checkAuthRateLimit(request, "signup")');
    expect(signupRoute).toContain("isDisposableEmailAddress(email)");
    expect(signupRoute).toContain("isSameOriginMutation(request)");
  });
});

describe("the honeypot", () => {
  it("is refused before any account work, with a message that gives nothing away", () => {
    const trap = signupRoute.indexOf("fields.fax");
    const insert = signupRoute.indexOf("db.insert(users)");
    expect(trap).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(trap);
    const refusal = signupRoute.slice(trap, trap + 400);
    expect(refusal).toContain("Could not create that account.");
    expect(refusal.toLowerCase()).not.toContain("honeypot");
    expect(refusal.toLowerCase()).not.toContain("bot");
  });

  it("only trips on a non-empty value, so an untouched field is harmless", () => {
    expect(signupRoute).toContain('typeof fields.fax === "string" && fields.fax.trim().length > 0');
  });

  it("is unreachable by a person and invisible to a screen reader", () => {
    expect(authForm).toContain('aria-hidden="true"');
    expect(authForm).toContain("tabIndex={-1}");
    expect(authForm).toContain('name="pryva_fax"');
    // Named fax rather than website: password managers autofill a website field,
    // and blocking a real customer for their browser's helpfulness is worse than
    // letting one naive bot past.
    expect(authForm).not.toContain('name="website"');
  });

  it("is rendered for signup only", () => {
    const guard = authForm.indexOf('{mode === "signup" && (');
    expect(guard).toBeGreaterThan(-1);
    expect(authForm.indexOf('name="pryva_fax"')).toBeGreaterThan(guard);
  });
});

describe("the form and the widget", () => {
  it("gets its key from the server, never from a hardcoded literal", () => {
    expect(signupPage).toContain("turnstileSiteKey={turnstileSiteKey()}");
    expect(authForm).not.toMatch(/0x4[AAAA-Za-z0-9]{6,}/);
    expect(widget).not.toMatch(/0x4[AAAA-Za-z0-9]{6,}/);
  });

  it("never sends the secret key to the browser", () => {
    expect(widget).not.toContain("TURNSTILE_SECRET_KEY");
    expect(authForm).not.toContain("TURNSTILE_SECRET_KEY");
    expect(signupPage).not.toContain("TURNSTILE_SECRET_KEY");
  });

  it("blocks its own submit until a token exists, but only when a widget is shown", () => {
    expect(authForm).toContain('const captchaRequired = mode === "signup" && Boolean(turnstileSiteKey);');
    expect(authForm).toContain("disabled={pending !== null || (captchaRequired && !captchaToken)}");
  });

  it("sends the token with the signup payload and not with a sign-in", () => {
    expect(authForm).toContain("captchaToken: captchaToken ?? undefined");
    const signIn = authForm.indexOf(': { email: form.email, password: form.password };');
    const payload = authForm.slice(authForm.indexOf("const payload ="), signIn);
    expect(payload).toContain('mode === "signup"');
    expect(authForm.slice(signIn, signIn + 80)).not.toContain("captchaToken");
  });

  it("asks for a fresh challenge after a refused submit, because tokens are single use", () => {
    expect(authForm).toContain("if (captchaRequired) setCaptchaReset((value) => value + 1)");
    // Both the server-refused path and the network-failure path spend the token.
    expect(authForm.match(/setCaptchaReset\(\(value\) => value \+ 1\)/g)?.length).toBe(2);
  });

  it("reports a lost token on expiry, error and timeout", () => {
    for (const callback of ['"expired-callback"', '"error-callback"', '"timeout-callback"']) {
      expect(widget).toContain(callback);
    }
    expect(widget.match(/report\.current\(null\)/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("renders explicitly and cleans up, so switching auth modes cannot leave a dead widget", () => {
    expect(widget).toContain("render=explicit");
    expect(widget).toContain("api.remove(widgetId.current)");
    expect(widget).toContain("widgetId.current !== undefined");
  });

  it("tells the visitor when a script blocker stopped the challenge loading", () => {
    expect(widget).toContain("onError=");
    expect(widget).toContain("could not load");
  });
});

describe("deployment", () => {
  it("documents both keys and says why both are required", () => {
    expect(envExample).toContain("NEXT_PUBLIC_TURNSTILE_SITE_KEY=");
    expect(envExample).toContain("TURNSTILE_SECRET_KEY=");
    expect(envExample).toContain("BOTH are required");
  });

  it("opens the Cloudflare origin only when a widget is configured", () => {
    expect(proxy).toContain("turnstile: Boolean(runtimeEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim())");
    // Not the spelling Next inlines at build time: the page reads the key per
    // request, so a build-time CSP could end up blocking a runtime widget.
    expect(proxy).toContain("const runtimeEnv: Record<string, string | undefined> = process.env;");
  });

  it("shows the operator whether the challenge is actually on", () => {
    const page = read("src/app/admin/(console)/security/page.tsx");
    const card = read("src/app/admin/(console)/security/SignupProtection.tsx");
    expect(page).toContain("<SignupProtection />");
    expect(card).toContain("isTurnstileConfigured()");
    // The half-configured state must not read as protected.
    expect(card).toContain("TURNSTILE_SECRET_KEY is missing");
  });
});
