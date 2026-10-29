import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, hashPassword } from "@/lib/auth";
import { exchangeGoogleCode, fetchGoogleUser, googleConfigured } from "@/lib/google";
import { relativeRedirect } from "@/lib/net";
import { creditWallet } from "@/lib/wallet";
import { safeRedirectPath } from "@/lib/safe-redirect";

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
  if (!code || !state || !expectedState || state !== expectedState) {
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
        })
        .returning();
      user = created;

    }

    if (!user) return clearCookies(goToLogin("google-exchange"));

    await createSession(user.id, request);
    return clearCookies(relativeRedirect(next, 302));
  } catch (oauthError) {
    console.error("Google sign-in failed:", oauthError);
    return clearCookies(goToLogin("google-exchange"));
  }
}
