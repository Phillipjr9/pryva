import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users, type User } from "@/db/schema";
import { requestProto } from "@/lib/net";
import { isDemoEmail, isPreviewDatabase } from "@/lib/demo-policy";

export const SESSION_COOKIE = "pryva_session";
const SESSION_DAYS = 30;

/**
 * Browsers silently drop Secure cookies served over plain HTTP. Derive the
 * flag from the externally-visible protocol (works for https previews and
 * http development alike) instead of NODE_ENV alone.
 */
export async function requestIsSecure(): Promise<boolean> {
  try {
    const headerList = await headers();
    const proto = headerList.get("x-forwarded-proto");
    if (proto) return proto.startsWith("https");
    const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
    if (host) {
      return !(
        host.startsWith("localhost") ||
        host.startsWith("127.") ||
        host.startsWith("0.0.0.0") ||
        host.endsWith(".local") ||
        host.includes(":")
      );
    }
  } catch {
    /* headers() unavailable — fall through */
  }
  return process.env.NODE_ENV === "production";
}

async function isCrossSiteIframeRequest(request?: Request): Promise<boolean> {
  try {
    if (request) {
      const site = request.headers.get("sec-fetch-site");
      const dest = request.headers.get("sec-fetch-dest");
      if (site === "cross-site" || dest === "iframe") return true;
    }
    const headerList = await headers();
    const site = headerList.get("sec-fetch-site");
    const dest = headerList.get("sec-fetch-dest");
    return site === "cross-site" || dest === "iframe";
  } catch {
    return false;
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

export type PublicUser = Pick<User, "id" | "name" | "email" | "walletBalance" | "createdAt">;

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    walletBalance: user.walletBalance,
    createdAt: user.createdAt,
  };
}

export async function createSession(userId: string, request?: Request): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({ token, userId, expiresAt });

  const secure = request ? requestProto(request) === "https" : await requestIsSecure();
  const useCrossSiteCookie = secure && (await isCrossSiteIframeRequest(request));
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: useCrossSiteCookie ? "none" : "lax",
    secure,
    ...(useCrossSiteCookie ? { partitioned: true } : {}),
    path: "/",
    expires: expiresAt,
  });

  return token;
}

export async function getCurrentUser(): Promise<PublicUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row || (isDemoEmail(row.user.email) && !isPreviewDatabase())) return null;
  return toPublicUser(row.user);
}

export async function requireAuth(
  requestOrPath?: Request | string,
  nextPath = "/dashboard",
): Promise<PublicUser> {
  const destination = typeof requestOrPath === "string" ? requestOrPath : nextPath;
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(destination)}`);
  }
  return user;
}

export function isConfiguredAdminEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized);
}

export function isAdminUser(user: Pick<User, "email"> | PublicUser | null): boolean {
  // The one-click demo identity must never become an administrator, even if
  // it is accidentally added to the allowlist.
  return Boolean(user && !isDemoEmail(user.email) && isConfiguredAdminEmail(user.email));
}

export async function requireUser(nextPath = "/dashboard"): Promise<PublicUser> {
  return requireAuth(nextPath);
}

export async function requireAdmin(nextPath = "/admin/dashboard"): Promise<PublicUser> {
  const user = await requireAuth(nextPath);

  if (!isAdminUser(user)) {
    redirect(`/dashboard?error=admin-required`);
  }

  return user;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.token, token));
  }
  const secure = await requestIsSecure();
  const useCrossSiteCookie = secure && (await isCrossSiteIframeRequest());
  jar.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: useCrossSiteCookie ? "none" : "lax",
    secure,
    ...(useCrossSiteCookie ? { partitioned: true } : {}),
    path: "/",
    maxAge: 0,
  });
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}
