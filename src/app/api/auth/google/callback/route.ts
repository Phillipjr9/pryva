import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, hashPassword } from "@/lib/identity/auth";
import { exchangeGoogleCode, fetchGoogleUser, googleConfigured } from "@/lib/identity/google";
import { stateAccepted } from "@/lib/identity/google-state";
import { relativeRedirect } from "@/lib/platform/net";
import { creditWallet } from "@/lib/payments/wallet";
import { safeRedirectPath } from "@/lib/platform/safe-redirect";
import { attributeReferral, readReferralCodeFrom } from "@/lib/content/referrals";
import { recordSignupSignal } from "@/lib/admin/fraud";
import { noteSignupAndMaybeAlert } from "@/lib/admin/signup-spike";
import { scheduleOnboardingEmails } from "@/lib/email/onboarding-emails";
import { scheduleVerifiedSignupAlert } from "@/lib/email/signup-alert";
import { clientIp } from "@/lib/identity/auth-rate-limit";
import { oauthRateLimiter } from "@/lib/platform/rate-limit";
import { verifyTurnstileToken } from "@/lib/platform/turnstile";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "pryva_google_state";
const NEXT_COOKIE = "pryva_google_next";
/** Set by `/api/auth/google` from the token solved on the sign-up card. */
const CAPTCHA_COOKIE = "pryva_google_captcha";

function goToLogin(error: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `/login?error=${error}` },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const jar = await cookies();
  const expectedState = jar.get(STATE_COOKIE)?.value;
  const storedNext = jar.get(NEXT_COOKIE)?.value;
  const captchaCookie = jar.get(CAPTCHA_COOKIE)?.value;
  let captchaToken: string | undefined;
  try {
    captchaToken = captchaCookie ? decodeURIComponent(captchaCookie) : undefined;
  } catch { /* A corrupt cookie is simply no token. */ }
  let decodedNext: string | undefined;
  try { decodedNext = storedNext ? decodeURIComponent(storedNext) : undefined; } catch { /* Invalid cookie: use the default. */ }
  const next = safeRedirectPath(decodedNext);

  const clearCookies = (response: Response): Response => {
    const base = "Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
    response.headers.append("Set-Cookie", `${STATE_COOKIE}=; ${base}`);
    response.headers.append("Set-Cookie", `${NEXT_COOKIE}=; ${base}`);
    // Single use, like the token itself: clearing it here means a browser that
    // goes through the flow twice cannot replay the first challenge.
    response.headers.append("Set-Cookie", `${CAPTCHA_COOKIE}=; ${base}`);
    return response;
  };

  if (error) return clearCookies(goToLogin("google-canceled"));
  if (!googleConfigured()) return clearCookies(goToLogin("google-not-configured"));
  // A signed state alone is not bound to this browser. Require the cookie too,
  // or an attacker can attach their own Google account to someone else's login.
  if (!code || !stateAccepted(state, expectedState)) {
    return clearCookies(goToLogin("google-state"));
  }

  /*
   * The return leg is throttled before anything is exchanged.
   *
   * Everything below this line costs at least one HTTPS call to Google, and a
   * brand-new account costs a row, a referral lookup, a queued email and an
   * operator alert. Signup got a Turnstile challenge; this branch did not, so a
   * script with a stock of verified Google identities could mint accounts here
   * all day without ever meeting the challenge it was designed to fail.
   *
   * `unavailable` fails closed, as it does everywhere else that spends shared
   * state: if the counter cannot be read, the return leg is refused rather than
   * allowed through unmetered.
   */
  const throttle = await oauthRateLimiter(`google:callback:ip:${clientIp(request)}`);
  if (throttle.unavailable || !throttle.allowed) {
    return clearCookies(goToLogin("google-throttled"));
  }

  try {
    const accessToken = await exchangeGoogleCode(request, code);
    const profile = await fetchGoogleUser(accessToken);
    if (!profile.emailVerified || !profile.sub || profile.sub.length > 255) {
      return clearCookies(goToLogin("google-exchange"));
    }

    // A verified Google email does not prove ownership of an existing local
    // account: local email signups do not yet verify their addresses. Only a
    // previously bound Google subject may sign into an existing account.
    let [user] = await db.select().from(users).where(eq(users.googleSubject, profile.sub)).limit(1);
    if (user && user.email.toLowerCase() !== profile.email.toLowerCase()) {
      return clearCookies(goToLogin("google-account-exists"));
    }
    if (!user) {
      const [existingEmail] = await db.select().from(users).where(eq(users.email, profile.email)).limit(1);
      if (existingEmail) return clearCookies(goToLogin("google-account-exists"));

      /*
       * A Google signup is a signup, so it meets the same challenge.
       *
       * Google proves the address, not the person: verified Google identities
       * are themselves a traded commodity, and this branch used to create a
       * fully verified account — plus an operator alert — for any of them,
       * while the password form next door demanded a Turnstile token. Leaving
       * that door open undid the challenge on the other one.
       *
       * The token is optional on the wire and required here only when the
       * deployment has the challenge configured, which is the same condition
       * `/api/auth/signup` enforces. A deployment without keys keeps working.
       *
       * An existing customer signing in is never asked: the check sits inside
       * this branch, after the account lookup, so it cannot lock anybody out of
       * an account they already own.
       */
      const challenge = await verifyTurnstileToken(captchaToken, clientIp(request));
      if (!challenge.ok) return clearCookies(goToLogin("google-challenge"));

      const [created] = await db
        .insert(users)
        .values({
          name: profile.name,
          email: profile.email,
          googleSubject: profile.sub,
          passwordHash: hashPassword(randomBytes(24).toString("hex")),
          walletBalance: 0,
          /*
           * Google has already proven control of this address, and the flow above
           * refuses to continue unless `email_verified` is true. Leaving this NULL
           * would put a "confirm your email" banner in front of a customer who has
           * no confirmation link and no way to get one -- every resend would go to
           * an address whose mailbox we have not asked about, for a proof we
           * already hold. It also gates withdrawals, so the account would be
           * locked out of payouts for no reason.
           */
          emailVerifiedAt: new Date(),
        })
        .returning();
      user = created;

      await recordSignupSignal(request, created.id);

      // A Google signup completes verification at creation, so it gets the same
      // receipt and welcome a password signup gets when it clicks the link --
      // otherwise the fastest route into the product would be the only silent one.
      // The same aggregate question as a password signup: a burst of Google
      // accounts is the same attack wearing a different form.
      await noteSignupAndMaybeAlert();

      scheduleOnboardingEmails(created.id);

      // Google already proved the address, so this is the moment a Google
      // signup becomes a customer -- the same trigger a password signup gets
      // when it clicks its link. Without this, the operator would hear about
      // every email signup and no Google ones.
      scheduleVerifiedSignupAlert(created.id);

      // A Google signup is a signup: the invite cookie set on /signup counts
      // here too, or every customer who used Google would be unattributable.
      const referralCode = readReferralCodeFrom(request);
      if (referralCode) {
        await attributeReferral({ refereeId: created.id, code: referralCode }).catch((error) => {
          console.error("[referrals] attribution failed", error instanceof Error ? error.message : String(error));
        });
      }
    }

    if (!user) return clearCookies(goToLogin("google-exchange"));

    await createSession(user.id, request);
    return clearCookies(relativeRedirect(next, 302));
  } catch (oauthError) {
    console.error("Google sign-in failed:", oauthError instanceof Error ? oauthError.message : String(oauthError));
    return clearCookies(goToLogin("google-exchange"));
  }
}
