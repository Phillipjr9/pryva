import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users, type User } from "@/db/schema";
import { isArenaPreviewHost, isLocalHost, requestProto } from "@/lib/net";

export const SESSION_COOKIE = "pryva_session";
/**
 * Fallback copy of the same token for embedded previews.
 *
 * The Arena/VS Code preview renders the app inside a third-party iframe. Browsers
 * drop `SameSite=Lax` cookies there, and `SameSite=None` is only accepted
 * together with `Secure` — which older logic could fail to set when the
 * forwarding proxy hid `x-forwarded-proto` and reported a `localhost` host. When
 * that happened the demo login "worked" (303 into /dashboard) and then bounced
 * straight back to /login, because the browser had thrown the cookie away.
 */
export const SESSION_COOKIE_EMBEDDED = "pryva_session_3p";
const SESSION_DAYS = 30;

/**
 * Browsers silently drop Secure cookies served over plain HTTP. Derive the
 * flag from the externally-visible protocol (works for https previews and
 * http development alike) instead of NODE_ENV alone.
 */
export async function requestIsSecure(): Promise<boolean> {
  try {
    const headerList = await headers();
    const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
    if (host && isArenaPreviewHost(host)) return true;
    const proto = headerList.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
    if (proto === "https" || proto === "http") return proto === "https";
    if (host) return !isLocalHost(host);
  } catch {
    /* headers() unavailable — fall through */
  }
  return process.env.NODE_ENV === "production";
}

async function needsEmbeddedSessionCookie(request?: Request): Promise<boolean> {
  try {
    const headerList = request?.headers ?? await headers();
    const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
    // Fetches from inside an iframe report same-origin/empty, so their headers
    // do not reveal the embedding. The Arena preview can be embedded even for
    // those requests; use partitioned cookies for all of its session issuances.
    return isArenaPreviewHost(host) || headerList.get("sec-fetch-site") === "cross-site" || headerList.get("sec-fetch-dest") === "iframe";
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

export type PublicUser = Pick<
  User,
  "id" | "name" | "email" | "walletBalance" | "emailVerifiedAt" | "createdAt"
>;

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    walletBalance: user.walletBalance,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
  };
}

export async function createSession(userId: string, request?: Request): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({ token, userId, expiresAt });

  const proto = request ? requestProto(request) : (await requestIsSecure()) ? "https" : "http";
  const embedded = await needsEmbeddedSessionCookie(request);
  // An embedded page is served over TLS even when the proxy doesn't say so;
  // without `Secure` the browser discards a `SameSite=None` cookie outright.
  const secure = proto === "https" || embedded;

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: embedded ? "none" : "lax",
    secure,
    ...(embedded ? { partitioned: true } : {}),
    path: "/",
    expires: expiresAt,
  });

  if (embedded) {
    // Browsers without CHIPS support still need a plain Lax copy for when the
    // preview is opened as its own tab; the reader accepts either name.
    jar.set(SESSION_COOKIE_EMBEDDED, token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      expires: expiresAt,
    });
  }

  if (process.env.NODE_ENV !== "production") {
    console.info("[auth] session issued", {
      embedded,
      secure,
      proto,
      host: request?.headers.get("x-forwarded-host") ?? request?.headers.get("host") ?? "-",
      dest: request?.headers.get("sec-fetch-dest") ?? "-",
      site: request?.headers.get("sec-fetch-site") ?? "-",
    });
  }

  return token;
}

async function sessionUser(token: string): Promise<User | null> {
  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0]?.user ?? null;
}

export async function getCurrentUser(): Promise<PublicUser | null> {
  const jar = await cookies();
  const cookieTokens = new Set([jar.get(SESSION_COOKIE)?.value, jar.get(SESSION_COOKIE_EMBEDDED)?.value].filter((value): value is string => Boolean(value)));
  for (const token of cookieTokens) {
    const user = await sessionUser(token);
    if (user) return toPublicUser(user);
  }

  if (!cookieTokens.size && process.env.NODE_ENV !== "production") {
    console.info("[auth] no session cookie on this request");
  }
  return null;
}

/**
 * API-safe auth check.
 *
 * `requireAuth()` calls `redirect()`, which throws NEXT_REDIRECT. Inside a route
 * handler that becomes a 500 (or a 307 to an HTML page for `fetch` callers),
 * never the 401 JSON a client can act on. Every `/api/*` route must use this
 * instead and return its own 401.
 */
export async function requireAuthApi(): Promise<PublicUser | null> {
  return getCurrentUser();
}

export async function requireAuth(
  requestOrPath?: Request | string,
  nextPath = "/dashboard",
): Promise<PublicUser> {
  const destination = typeof requestOrPath === "string" ? requestOrPath : nextPath;
  const user = await getCurrentUser();
  if (!user) {
    // `bounced` lets the sign-in page explain itself: landing back here right
    // after a successful-looking sign-in means the browser refused the session
    // cookie (embedded previews do this), not that the button was broken.
    redirect(`/login?next=${encodeURIComponent(destination)}&bounced=1`);
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

/**
 * Administrator access requires a verified address.
 *
 * ADMIN_EMAILS grants privilege by string match, and signup accepted any address
 * with no proof of control -- so on a public site, matching on email alone let
 * anyone register a configured administrator's address and inherit their access.
 * Requiring proof of control is what makes the match mean something.
 *
 * The field has to travel on PublicUser for this to work: toPublicUser strips
 * anything not in that Pick, so gating on a field the type did not carry would
 * have denied every administrator permanently and silently.
 */
export function isAdminUser(
  user: Pick<User, "email" | "emailVerifiedAt"> | PublicUser | null,
): boolean {
  return Boolean(user && user.emailVerifiedAt && isConfiguredAdminEmail(user.email));
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
  const tokens = new Set([jar.get(SESSION_COOKIE)?.value, jar.get(SESSION_COOKIE_EMBEDDED)?.value].filter((value): value is string => Boolean(value)));
  for (const token of tokens) {
    await db.delete(sessions).where(eq(sessions.token, token));
  }
  const embedded = await needsEmbeddedSessionCookie();
  const secure = (await requestIsSecure()) || embedded;
  jar.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: embedded ? "none" : "lax",
    secure,
    ...(embedded ? { partitioned: true } : {}),
    path: "/",
    maxAge: 0,
  });
  jar.set(SESSION_COOKIE_EMBEDDED, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
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
