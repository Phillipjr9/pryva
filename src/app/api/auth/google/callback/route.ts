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
import { scheduleOnboardingEmails } from "@/lib/email/onboarding-emails";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "pryva_google_state";
const NEXT_COOKIE = "pryva_google_next";

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
  let decodedNext: string | undefined;
  try { decodedNext = storedNext ? decodeURIComponent(storedNext) : undefined; } catch { /* Invalid cookie: use the default. */ }
  const next = safeRedirectPath(decodedNext);

  const clearCookies = (response: Response): Response => {
    const base = "Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
    response.headers.append("Set-Cookie", `${STATE_COOKIE}=; ${base}`);
    response.headers.append("Set-Cookie", `${NEXT_COOKIE}=; ${base}`);
    return response;
  };

  if (error) return clearCookies(goToLogin("google-canceled"));
  if (!googleConfigured()) return clearCookies(goToLogin("google-not-configured"));
  // A signed state alone is not bound to this browser. Require the cookie too,
  // or an attacker can attach their own Google account to someone else's login.
  if (!code || !stateAccepted(state, expectedState)) {
    return clearCookies(goToLogin("google-state"));
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
      scheduleOnboardingEmails(created.id);

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
