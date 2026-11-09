import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users, type User } from "@/db/schema";
import { isArenaPreviewHost, isLocalHost, requestProto } from "@/lib/platform/net";
import { adminBlockedForMissingSecondFactor } from "@/lib/identity/admin-two-factor";
import {
  customerEnrolmentUrl,
  isSecondFactorExemptPath,
  secondFactorGateApplies,
} from "@/lib/identity/require-second-factor";
import {
  SESSION_COOKIE as SESSION_COOKIE_NAME,
  SESSION_COOKIE_EMBEDDED as SESSION_COOKIE_EMBEDDED_NAME,
  SESSION_TOKENS_HEADER,
  cookieHeaderWithout,
  copiesToClear,
  expirySetCookies,
  sessionCookieCopies,
  type SessionCookieCopy,
} from "@/lib/platform/session-cookies";

export const SESSION_COOKIE = "pryva_session";

/**
 * The `Domain` a session cookie should carry.
 *
 * Two names are involved once a site moves to its own domain: the apex
 * (`pryvalogs.com`) and the `www.` host. A cookie set without `Domain` is
 * host-only, so signing in on one and opening the other silently loses the
 * session — the browser drops it and the user is bounced back to the sign-in
 * page with no error to point at.
 *
 * On the canonical domain the cookie is written for the registrable domain so
 * both names share it. Everywhere else — previews, `*.vercel.app`, localhost —
 * it stays host-only, which is the safe default: a `Domain` of `vercel.app` would
 * be sent to every unrelated project on that suffix.
 *
 * Deliberately not derived from `NEXT_PUBLIC_SITE_URL` alone: a request on a
 * host that is not in the canonical family must not be handed a cookie scoped to
 * that family.
 */
export function sessionCookieDomain(host: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const bare = (host ?? "").split(":")[0].trim().toLowerCase();
  if (!bare || isLocalHost(bare)) return undefined;
  const pinned = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!pinned) return undefined;
  let pinnedHost: string;
  try {
    pinnedHost = new URL(pinned).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  const apex = pinnedHost.replace(/^www\./, "");
  // Only for the canonical domain and its own `www.`, and only when the apex
  // has a dot -- a two-label host is not a registrable domain worth widening to.
  if (bare !== apex && bare !== `www.${apex}`) return undefined;
  return apex.includes(".") ? apex : undefined;
}
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

  // Serialize issuance with suspension. An in-flight second-factor or OAuth
  // challenge cannot create a surviving session after an operator suspends it.
  await db.transaction(async (tx) => {
    const [account] = await tx.select({ id: users.id }).from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt), isNull(users.suspendedAt)))
      .for("update").limit(1);
    if (!account) throw new Error("Account unavailable");
    await tx.insert(sessions).values({ token, userId, expiresAt });
  });

  const proto = request ? requestProto(request) : (await requestIsSecure()) ? "https" : "http";
  const embedded = await needsEmbeddedSessionCookie(request);
  // An embedded page is served over TLS even when the proxy doesn't say so;
  // without `Secure` the browser discards a `SameSite=None` cookie outright.
  const secure = proto === "https" || embedded;

  const jar = await cookies();
  const cookieDomain = sessionCookieDomain(request?.headers.get("x-forwarded-host") ?? request?.headers.get("host"));
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: embedded ? "none" : "lax",
    secure,
    ...(embedded ? { partitioned: true } : {}),
    ...(cookieDomain ? { domain: cookieDomain } : {}),
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
    const rawHost = request?.headers.get("x-forwarded-host") ?? request?.headers.get("host") ?? "-";
    console.info("[auth] session issued", {
      embedded,
      secure,
      proto,
      host: /^[a-zA-Z0-9._:[-\]]+$/.test(rawHost) ? rawHost : "[invalid-host]",
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
    .where(
      and(
        eq(sessions.token, token),
        gt(sessions.expiresAt, new Date()),
        // A closed account cannot be signed into, whatever else survived. Closing
        // deletes every session row as well; this is the second lock, because
        // "every session was deleted" is a fact about a previous request.
        isNull(users.deletedAt),
        isNull(users.suspendedAt),
      ),
    )
    .limit(1);
  return rows[0]?.user ?? null;
}

/**
 * Every session token this request carries, not just the one Next kept.
 *
 * `cookies().get()` and `cookies().getAll()` both collapse on name, so a browser
 * holding two `pryva_session` cookies — a host-only one from before the domain
 * move, and a `Domain=` one issued after it — shows this process only one of
 * them, and which one is unspecified (RFC 6265 forbids relying on the order).
 * When the dead copy is the one kept, a correctly signed-in visitor is treated
 * as signed out on every request.
 *
 * `proxy.ts` parses the raw `Cookie` header, where both copies are still
 * visible, and passes every candidate through `SESSION_TOKENS_HEADER`. This
 * prefers those and falls back to the jar, which is what happens on any request
 * the proxy does not run for.
 *
 * The header is proxy-written: a client-supplied copy is overwritten before it
 * reaches this code, so it can only ever contain tokens the browser actually
 * sent. A token still has to resolve to a live session row to mean anything.
 */
async function requestSessionTokens(): Promise<Set<string>> {
  const tokens = new Set<string>();
  try {
    const headerList = await headers();
    const forwarded = headerList.get(SESSION_TOKENS_HEADER) ?? "";
    for (const token of forwarded.split(",")) {
      const trimmed = token.trim();
      if (trimmed) tokens.add(trimmed);
    }
  } catch {
    /* `headers()` unavailable — fall back to the jar below */
  }

  const jar = await cookies();
  for (const cookie of [SESSION_COOKIE, SESSION_COOKIE_EMBEDDED]) {
    const value = jar.get(cookie)?.value;
    if (value) tokens.add(value);
  }
  return tokens;
}

const NO_TOKENS = { user: null, deadTokens: [] as string[], tokens: [] as string[] };

/**
 * Resolve the caller, and report which tokens turned out to be worthless.
 *
 * The second half is what lets a stale twin be removed instead of shadowing the
 * live cookie forever: `expireDeadSessionCookies` below deletes exactly the
 * copies that were checked and matched no session. Nothing that authenticated is
 * ever reported as dead, so the repair cannot sign anyone out.
 *
 * When the session store cannot be reached, `resolved` is false and *nothing* is
 * reported dead. "I could not check" must not be treated as "this is invalid",
 * or a database blip would delete every visitor's cookies.
 */
async function resolveCurrentUser(): Promise<{
  user: PublicUser | null;
  deadTokens: string[];
  tokens: string[];
  resolved: boolean;
}> {
  let tokens: Set<string>;
  try {
    tokens = await requestSessionTokens();
  } catch {
    return { ...NO_TOKENS, resolved: false };
  }

  const dead: string[] = [];
  for (const token of tokens) {
    let user: User | null;
    try {
      user = await sessionUser(token);
    } catch (error) {
      console.error("[auth] could not check a session token", error instanceof Error ? error.message : String(error));
      return { user: null, deadTokens: [], tokens: [...tokens], resolved: false };
    }
    if (user) return { user: toPublicUser(user), deadTokens: dead, tokens: [...tokens], resolved: true };
    dead.push(token);
  }
  return { user: null, deadTokens: dead, tokens: [...tokens], resolved: true };
}

export async function getCurrentUser(): Promise<PublicUser | null> {
  const { user, tokens } = await resolveCurrentUser();
  if (!user && !tokens.length && process.env.NODE_ENV !== "production") {
    console.info("[auth] no session cookie on this request");
  }
  return user;
}

/**
 * Delete session cookies that a browser is holding but that authenticate nothing.
 *
 * ## The problem this solves
 *
 * A visitor who signed in before this site moved to `pryvalogs.com` holds a
 * host-only `pryva_session`. Signing in afterwards writes a second one scoped to
 * the domain. The old session row may be long gone, but the cookie is not: it
 * sits beside the new one, every request carries both, and depending on which
 * copy the framework keeps the visitor is either signed in or silently locked
 * out. Signing in again does not help — it adds another cookie to the pile.
 *
 * ## Why deleting is safe here
 *
 * Only a token that was checked and matched no live session is expired. Nothing
 * that authenticated is ever touched, so this cannot sign anybody out. When the
 * session store is unreachable nothing is reported dead at all: a failure to
 * check is not evidence of a bad cookie.
 *
 * Two cookies are cleared per response, not every one found — a page load that
 * sets six expiries looks like an attack in a network tab, and the realistic
 * case is a single stale twin. A visitor with more than two converges over the
 * next couple of page loads.
 *
 * `cookieJar` is passed in so the caller reuses the jar it already read; this
 * function must run in a Server Action or Route Handler context, where cookies
 * may be written.
 */
export async function expireDeadSessionCookies(
  jar: Awaited<ReturnType<typeof cookies>>,
): Promise<void> {
  const { deadTokens, resolved } = await resolveCurrentUser();
  if (!resolved || !deadTokens.length) return;

  /*
   * Which copies are still on this request? `sessionCookieCopies` reads the raw
   * header, because the jar has already collapsed them. Only a dead token that
   * is *also* a cookie the browser sent can be expired — a token that came from
   * somewhere else has no cookie to delete.
   */
  let copies: SessionCookieCopy[];
  try {
    copies = sessionCookieCopies((await headers()).get("cookie"));
  } catch {
    return;
  }
  const dead = new Set(deadTokens);
  const doomed = copies.filter((copy) => dead.has(copy.value));
  if (!doomed.length) return;

  const host = (await headers()).get("x-forwarded-host") ?? (await headers()).get("host");
  const domain = sessionCookieDomain(host);
  for (const copy of copiesToClear(doomed)) {
    /*
     * A host-only cookie and a domain cookie are distinct to the browser and are
     * removed by a `Set-Cookie` that matches the one it holds. The jar cannot key
     * two entries on one name, so the domain form is written directly onto the
     * response; the host-only form goes through the jar. A `Set-Cookie` for a
     * cookie the browser does not hold is ignored, so sending both is free.
     */
    const [hostOnly] = expirySetCookies(copy, [undefined]);
    if (domain) {
      const withDomain = expirySetCookies(copy, [domain])[0];
      if (withDomain) jar.set(copy.name, "", { path: "/", domain, maxAge: 0, httpOnly: true, sameSite: "lax", secure: true });
    }
    if (hostOnly) {
      jar.set(copy.name, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax", secure: true });
    }
  }
}

/**
 * API-safe auth check.
 *
 * `requireAuth()` calls `redirect()`, which throws NEXT_REDIRECT. Inside a route
 * handler that becomes a 500 (or a 307 to an HTML page for `fetch` callers),
 * never the 401 JSON a client can act on. Every `/api/*` route must use this
 * instead and return its own 401.
 */
export async function requireAuthApi(options?: { allowUnenrolled?: boolean }): Promise<PublicUser | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (options?.allowUnenrolled) return user;

  /*
   * The customer-wide second-factor rule, when an operator has turned it on.
   *
   * Refused as a null here — the caller answers 401 — rather than a redirect: a
   * route handler that redirects returns HTML to a `fetch` caller, which the
   * dashboard reads as a network failure instead of "enrol first".
   *
   * The enrolment routes pass `allowUnenrolled` rather than the gate sniffing the
   * request path. There is no dependable way to read the pathname here (a route
   * handler receives no `Request` in this signature, and `next/headers` does not
   * carry it), and a gate that guessed would either refuse the calls that
   * satisfy the rule or wave through the ones that should not.
   */
  if (!isAdminUser(user) && (await secondFactorGateApplies(user.id))) return null;
  return user;
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

  /*
   * The customer-wide second-factor rule, when enabled.
   *
   * Redirected to the one page that resolves it, carrying where they were going
   * so the return trip is a single click -- the same shape `requireAdmin` uses
   * for operators.
   *
   * `isSecondFactorExemptPath` is what stops this looping: the settings page
   * calls `requireAuth` too, and without the exemption it would redirect to
   * itself forever. Only the enrolment screens are exempt; they still require a
   * session, and none of them can spend money or read an order.
   */
  // Administrators are exempt: `requireAdmin` already enforces their own rule
  // and sends them to `/admin/account`. Applying the customer rule here would
  // bounce an operator into the storefront to arm the console, which is exactly
  // what the two-surface split exists to prevent.
  if (!isAdminUser(user) && !isSecondFactorExemptPath(destination) &&
      (await secondFactorGateApplies(user.id))) {
    redirect(customerEnrolmentUrl(destination));
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

export async function requireAdmin(
  nextPath = "/admin",
  /**
   * Set by the one page that *resolves* a missing second factor.
   *
   * Without it that page is unreachable: `requireAdmin` redirects an unenrolled
   * operator to `/admin/account`, and `/admin/account` calls `requireAdmin`,
   * which redirects it to itself. The loop is invisible until `TWO_FACTOR_KEY`
   * exists — before that the gate short-circuits to "not required" — and then it
   * locks every operator out of the console, including the page that fixes it.
   *
   * Only the enrolment screen may pass this. It still requires a signed-in
   * administrator; it only skips the second-factor test that the page exists to
   * satisfy.
   */
  options?: { allowUnenrolled?: boolean },
): Promise<PublicUser> {
  // Signed out. The console has its own door, so an operator who follows a console
  // link lands on the operator sign-in rather than on the storefront's. Both end at
  // the same session; this only decides which page asks for it.
  const signedOut = await getCurrentUser();
  if (!signedOut) {
    redirect(`/admin/login?next=${encodeURIComponent(nextPath)}`);
  }
  const user = signedOut;

  if (!isAdminUser(user)) {
    redirect(`/dashboard?error=admin-required`);
  }

  if (options?.allowUnenrolled) return user;

  // An administrator can approve withdrawals and issue refunds, so the account
  // that does it carries a second factor. Instead of an error, the redirect sends
  // them to the page that fixes it — with where they were going, so the return
  // trip is one click. That page lives inside the console, because sending an
  // operator into the customer dashboard to arm the console contradicts the whole
  // point of having two.
  if (await adminBlockedForMissingSecondFactor(user.id)) {
    redirect(`/admin/account?require=2fa&next=${encodeURIComponent(nextPath)}`);
  }

  return user;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  /*
   * Every copy, not just the one the jar kept.
   *
   * A browser holding two `pryva_session` cookies sends both; the jar collapses
   * them to one. Signing out therefore deleted one session row and expired one
   * cookie, leaving the twin alive — so the visitor could sign out and still
   * arrive on a page as a signed-in ghost, or (the more common shape) sign out,
   * sign in, and still be shadowed by the old copy. Reading the raw header is
   * the only way to see both.
   */
  let rawCopies: SessionCookieCopy[] = [];
  try {
    rawCopies = sessionCookieCopies((await headers()).get("cookie"));
  } catch {
    /* no header context: fall back to the jar below */
  }
  const tokens = new Set<string>(rawCopies.map((copy) => copy.value));
  for (const cookie of [SESSION_COOKIE, SESSION_COOKIE_EMBEDDED]) {
    const value = jar.get(cookie)?.value;
    if (value) tokens.add(value);
  }
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
  // Also clear the domain-scoped copy. A session issued before the site moved to
  // its own domain was written host-only; one issued after is written for the
  // registrable domain. Logging out has to remove whichever of the two this
  // browser holds, or "sign out" leaves a working session behind on one host.
  const clearDomain = sessionCookieDomain(
    (await headers()).get("x-forwarded-host") ?? (await headers()).get("host"),
  );
  if (clearDomain) {
    jar.set(SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: embedded ? "none" : "lax",
      secure,
      path: "/",
      domain: clearDomain,
      maxAge: 0,
    });
  }
  jar.set(SESSION_COOKIE_EMBEDDED, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  });

  /*
   * Expire the twin of every copy that was on the request, in both the
   * host-only and the domain spelling. The three `jar.set` calls above can only
   * describe one cookie per name, so without this a browser that held two
   * session cookies keeps one of them after signing out.
   */
  for (const copy of rawCopies) {
    if (copy.name !== SESSION_COOKIE && copy.name !== SESSION_COOKIE_EMBEDDED) continue;
    for (const domain of [undefined, clearDomain]) {
      jar.set(copy.name, "", {
        httpOnly: true,
        sameSite: embedded ? "none" : "lax",
        secure,
        path: "/",
        maxAge: 0,
        ...(domain ? { domain } : {}),
      });
    }
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}
