import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { db, hasDatabase } from "@/db";
import { sessions, users, type User } from "@/db/schema";
import { DEMO_SESSION_TOKEN, DEMO_USER } from "@/lib/demo-account";
import { requestProto } from "@/lib/net";

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
  if (!hasDatabase && userId !== DEMO_USER.id) {
    throw new Error("Only the demo account is available without a database");
  }

  const token = hasDatabase ? randomBytes(32).toString("hex") : DEMO_SESSION_TOKEN;
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  if (hasDatabase) {
    await db.insert(sessions).values({ token, userId, expiresAt });
  }

  const secure = request ? requestProto(request) === "https" : await requestIsSecure();
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    expires: expiresAt,
  });

  return token;
}

export async function getCurrentUser(): Promise<PublicUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  if (!hasDatabase) {
    return token === DEMO_SESSION_TOKEN ? toPublicUser(DEMO_USER) : null;
  }

  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  return row ? toPublicUser(row.user) : null;
}

export async function requireUser(nextPath = "/dashboard"): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  return user;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token && hasDatabase) {
    await db.delete(sessions).where(eq(sessions.token, token));
  }
  jar.delete(SESSION_COOKIE);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}
