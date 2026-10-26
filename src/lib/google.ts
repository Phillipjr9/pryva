import { randomBytes } from "node:crypto";
import { publicOrigin } from "@/lib/net";

export function googleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim(),
  );
}

export function googleCallbackUri(request: Request): string {
  return `${publicOrigin(request)}/api/auth/google/callback`;
}

export function makeState(): string {
  return randomBytes(20).toString("hex");
}

export function googleAuthorizeUrl(request: Request, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: googleCallbackUri(request),
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

export async function exchangeGoogleCode(request: Request, code: string): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: googleCallbackUri(request),
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });

  const data = (await response.json()) as GoogleTokenResponse;
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description ?? data.error ?? "Google token exchange failed");
  }
  return data.access_token;
}

export type GoogleUser = {
  sub: string;
  email: string;
  name: string;
  emailVerified: boolean;
};

export async function fetchGoogleUser(accessToken: string): Promise<GoogleUser> {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });

  if (!response.ok) throw new Error("Could not read the Google profile");

  const data = (await response.json()) as {
    sub?: string;
    email?: string;
    name?: string;
    email_verified?: boolean;
  };

  if (!data.email || !data.sub) throw new Error("Google did not return an email address");

  return {
    sub: data.sub,
    email: data.email.toLowerCase(),
    name: data.name ?? data.email.split("@")[0],
    emailVerified: Boolean(data.email_verified ?? true),
  };
}
