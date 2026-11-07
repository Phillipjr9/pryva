import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { rateLimitRefusal, type RateLimitResult } from "@/lib/platform/rate-limit";
import { turnstileBuildGap } from "@/lib/platform/turnstile";

/**
 * The second door.
 *
 * The signup form was the only account-creation path anybody thought about, so
 * it was the only one that got a challenge — and the moment it did, the cheapest
 * way to make an account was the branch next to it. Google's callback created a
 * fully verified account, fired the operator alert and emailed the customer,
 * behind no challenge and no limit at all.
 *
 * These assertions describe the shape of the fix rather than the flow: the
 * callback must prove a challenge before it inserts, must be throttled before it
 * spends a Google round trip, and must never ask an existing customer for a
 * token on the way into an account they already own.
 */

const read = (path: string) => readFileSync(path, "utf8");

const googleCallback = read("src/app/api/auth/google/callback/route.ts");
const googleStart = read("src/app/api/auth/google/route.ts");
const signupRoute = read("src/app/api/auth/signup/route.ts");
const spike = read("src/lib/admin/signup-spike.ts");
const authForm = read("src/components/auth/AuthForm.tsx");
const searchRoute = read("src/app/api/search/route.ts");
const ordersRoute = read("src/app/api/orders/list/route.ts");
const banksRoute = read("src/app/api/wallet/banks/route.ts");
const verifyRoute = read("src/app/api/auth/verify-email/route.ts");

/** Split a source file at a marker, so "before" and "after" can be compared. */
function position(source: string, marker: string): number {
  const index = source.indexOf(marker);
  expect(index, `expected to find ${marker}`).toBeGreaterThan(-1);
  return index;
}

describe("Google signup meets the same challenge as the form", () => {
  it("verifies a token before the account row is written", () => {
    const verify = position(googleCallback, "await verifyTurnstileToken(");
    const insert = position(googleCallback, "db\n        .insert(users)");
    expect(verify).toBeLessThan(insert);
  });

  it("asks only when creating, never when someone is signing back in", () => {
    // The check has to live inside the `if (!user)` branch: a returning customer
    // has an account, and refusing them for a missing token would be a lockout.
    const notFound = position(googleCallback, "if (!user) {");
    const verify = position(googleCallback, "await verifyTurnstileToken(");
    const created = position(googleCallback, "user = created;");
    expect(verify).toBeGreaterThan(notFound);
    expect(verify).toBeLessThan(created);
  });

  it("is throttled before anything is exchanged with Google", () => {
    const limited = position(googleCallback, "await oauthRateLimiter(");
    const exchange = position(googleCallback, "await exchangeGoogleCode(");
    expect(limited).toBeLessThan(exchange);
  });

  it("fails closed when the counter cannot be read", () => {
    expect(googleCallback).toMatch(/throttle\.unavailable \|\| !throttle\.allowed/);
  });

  it("sends the token the visitor already solved from the sign-up card", () => {
    expect(authForm).toContain("captchaToken");
    // Without a token the control is inert rather than starting a round trip the
    // callback can only refuse.
    expect(authForm).toMatch(/mode === "signup" && captchaRequired && !captchaToken/);
  });

  /*
   * The token cannot travel in the query string.
   *
   * `redirect_uri` is the bare origin plus `/api/auth/google/callback`, so the
   * URL Google sends the browser back to carries only `code` and `state` — a
   * token appended to the start link is gone by the time it is needed. It is
   * bound in a short-lived cookie instead, which also ties the proof to the
   * browser that solved it.
   */
  it("binds the token to a cookie before leaving for Google", () => {
    expect(googleStart).toContain("pryva_google_captcha");
    expect(googleStart).toContain("captchaToken");
    expect(googleStart).toContain("Set-Cookie");
  });

  it("reads the token from the cookie, and complains if that cookie is not read", () => {
    expect(googleCallback).toContain("jar.get(CAPTCHA_COOKIE)");
    expect(googleCallback).toMatch(/verifyTurnstileToken\(captchaToken/);
  });

  it("resents the token and clears it when the callback ends", () => {
    // Single use: a second trip through the flow must not replay a spent token.
    expect(googleCallback).toContain("`${CAPTCHA_COOKIE}=; ${base}`");
  });

  it("tells the visitor what happened in words, not a bare code", () => {
    expect(authForm).toContain("google-challenge");
    expect(authForm).toContain("google-throttled");
  });
});

describe("the expensive authenticated reads have a budget", () => {
  it("throttles search after authentication, before the scans", () => {
    const auth = position(searchRoute, "await requireAuthApi()");
    const limit = position(searchRoute, "accountReadRateLimiter(");
    const scan = position(searchRoute, "ilike(");
    expect(auth).toBeLessThan(limit);
    expect(limit).toBeLessThan(scan);
  });

  it("throttles the order list before it queries", () => {
    expect(position(ordersRoute, "accountReadRateLimiter(")).toBeLessThan(
      position(ordersRoute, "db.query.orders.findMany("),
    );
  });

  it("throttles the bank directory before it calls the provider", () => {
    expect(position(banksRoute, "accountReadRateLimiter(")).toBeLessThan(
      position(banksRoute, "await inFlight"),
    );
  });

  it("collapses concurrent bank fetches into one upstream call", () => {
    // The cache is per instance, so a cold instance under a burst used to make
    // one provider call per request.
    expect(banksRoute).toContain("inFlight ??=");
  });
});

describe("creating an email is creating outbound mail", () => {
  it("caps verification sends per account", () => {
    expect(verifyRoute).toContain("rateLimitVerificationSend(");
  });

  it("checks the send budget only after the checks that send nothing", () => {
    const configured = position(verifyRoute, "if (!resendConfigured())");
    const send = position(verifyRoute, "rateLimitVerificationSend(");
    const issue = position(verifyRoute, "await issueEmailVerification(");
    expect(configured).toBeLessThan(send);
    expect(send).toBeLessThan(issue);
  });
});

describe("a refused read says so in a way a client can act on", () => {
  const now = Date.now();

  it("returns 429 with Retry-After when the budget is spent", async () => {
    const refusal = rateLimitRefusal({ allowed: false, remaining: 0, resetTime: now + 30_000 });
    expect(refusal?.status).toBe(429);
    expect(Number(refusal?.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("returns null when the caller may proceed", () => {
    expect(rateLimitRefusal({ allowed: true, remaining: 5, resetTime: now + 30_000 })).toBeNull();
  });

  it("refuses with 503 rather than allowing when the store is down", async () => {
    const counted: RateLimitResult = { allowed: false, remaining: 0, resetTime: now, unavailable: true };
    expect(rateLimitRefusal(counted)?.status).toBe(503);
  });
});

describe("a challenge configured at runtime but missing from the build is called out", () => {
  it("reports a build that shipped without the site key", () => {
    // Next inlines NEXT_PUBLIC_*, so the deployed page can render no widget while
    // the server happily verifies tokens for one — the failure mode that looks
    // configured and protects nothing.
    expect(
      turnstileBuildGap({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret" }, ""),
    ).toMatch(/without NEXT_PUBLIC_TURNSTILE_SITE_KEY/);
  });

  it("reports a secret with no site key, and a site key with no secret", () => {
    expect(turnstileBuildGap({ TURNSTILE_SECRET_KEY: "secret" })).toMatch(/no widget is rendered/);
    expect(turnstileBuildGap({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site" })).toMatch(/no token is ever checked/);
  });

  it("stays quiet when both halves are present and built in", () => {
    expect(
      turnstileBuildGap(
        { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret" },
        "site",
      ),
    ).toBeNull();
  });

  it("stays quiet when the challenge is deliberately off", () => {
    expect(turnstileBuildGap({}, "")).toBeNull();
  });
});

describe("a burst of signups announces itself instead of waiting to be noticed", () => {
  it("counts from the database, not from process memory", () => {
    // Several instances each see their own share; only the database sees the wave.
    expect(spike).toContain("accountsCreatedSince");
    expect(spike).toContain("count(*)");
  });

  it("only alerts above the threshold, and posts no visitor data", () => {
    expect(spike).toContain("SIGNUP_SPIKE_THRESHOLD");
    expect(spike).toContain("if (created < SIGNUP_SPIKE_THRESHOLD) return;");
    // A count, a window and a threshold reach the webhook; addresses and hashed
    // IPs stay in the console.
    expect(spike).toMatch(/sendAlert\([\s\S]*accounts: created/);
    expect(spike).not.toMatch(/sendAlert\([\s\S]*ipHash/);
  });

  it("is a doorbell, not a second brake", () => {
    // Detection must not block the signup it is reporting on.
    expect(spike).not.toMatch(/throw new Error\("Signup/);
    expect(spike).toContain("catch (error)");
  });

  it("rings from both account-creation paths", () => {
    expect(signupRoute).toContain("noteSignupAndMaybeAlert()");
    expect(googleCallback).toContain("noteSignupAndMaybeAlert()");
  });

  it("posts at most one alert a day", () => {
    expect(spike).toContain("SPIKE_WINDOW_MS");
    expect(spike).toMatch(/now - previous < SPIKE_WINDOW_MS/);
  });
});
