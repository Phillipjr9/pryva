/**
 * Duplicate session cookies, and why this file has to exist.
 *
 * ## The bug this fixes
 *
 * A browser sends *every* cookie whose name, path and domain match a request. A
 * name can therefore appear twice in one `Cookie` header, and on this site it
 * does: `pryva_session` is written host-only before the site moves to its own
 * domain, and with `Domain=pryvalogs.com` afterwards. Those are two different
 * cookies to the browser, so signing in does not necessarily replace the older
 * one — it can add beside it. The dead copy then outlives its session row.
 *
 * Next keeps exactly one of them (`RequestCookies` collapses on name, and
 * `getAll()` does too), so whichever it keeps is the whole answer. RFC 6265 is
 * explicit that the order duplicates arrive in is not something a server may
 * rely on, and browsers disagree; when the dead copy is the one kept, the
 * visitor signs in successfully, receives a valid cookie, and every page still
 * reports them signed out. `whoami` shows the shape of it precisely: a session
 * cookie arrived (`firstParty: true`) and no session matched it.
 *
 * ## Why the fix cannot live in `auth.ts`
 *
 * Both `cookies().get()` and `cookies().getAll()` collapse duplicates, and
 * `ResponseCookies` keys on name+path, so it cannot emit two expiries for one
 * name with different domains. Expiring a `Domain=` cookie *and* the host-only
 * copy it shadows needs two `Set-Cookie` headers on two different responses.
 *
 * So the work happens here, on the raw `Cookie` header, where both copies are
 * still visible:
 *
 *   1. read every copy and hand them to the app, so a live session is found
 *      whichever position the dead cookie occupies;
 *   2. schedule removal of the dead copies, one per response, so the browser
 *      converges on a single cookie without anyone clearing site data by hand.
 *
 * Deleting the browser's cookies is a heavy-handed thing for a request handler
 * to do, so it is confined to copies that provably cannot authenticate: a
 * cookie is only dropped after it failed to resolve to a session. A live cookie
 * is never touched, and if the session store cannot be reached nothing is
 * dropped at all — "could not check" must not log anyone out.
 */

/**
 * The session cookie names.
 *
 * Duplicated from `auth.ts` rather than imported: this module runs in the
 * proxy, and `auth.ts` pulls in the database, `next/headers` and the whole
 * crypto surface, none of which belong on that path. Two string constants that
 * `src/test/session-cookie-tokens.test.ts` keeps in step is the cheaper trade.
 */
export const SESSION_COOKIE = "pryva_session";
export const SESSION_COOKIE_EMBEDDED = "pryva_session_3p";

/** The synthetic request header the app reads the candidate tokens from. */
export const SESSION_TOKENS_HEADER = "x-pryva-session-tokens";

/** Cap on tokens carried, so a hostile header cannot inflate the lookup loop. */
const MAX_TOKENS = 6;

export type SessionCookieCopy = { name: string; value: string };

/** Every session-cookie copy in a raw `Cookie` header, in the order sent. */
export function sessionCookieCopies(cookieHeader: string | null | undefined): SessionCookieCopy[] {
  const copies: SessionCookieCopy[] = [];
  for (const part of (cookieHeader ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== SESSION_COOKIE && name !== SESSION_COOKIE_EMBEDDED) continue;
    const value = part.slice(separator + 1).trim();
    if (!value) continue;
    copies.push({ name, value });
  }
  return copies;
}

/**
 * The tokens to try, ordered, for the synthetic header.
 *
 * Every distinct value, first-party name before the embedded fallback. Ordering
 * is a courtesy, not a guarantee: the app tries each in turn, so the correct
 * answer does not depend on it.
 */
export function sessionTokensForHeader(copies: SessionCookieCopy[]): string {
  const seen = new Set<string>();
  const ordered = [
    ...copies.filter((copy) => copy.name === SESSION_COOKIE),
    ...copies.filter((copy) => copy.name === SESSION_COOKIE_EMBEDDED),
  ];
  for (const copy of ordered) {
    if (seen.size >= MAX_TOKENS) break;
    seen.add(copy.value);
  }
  return [...seen].join(",");
}

/**
 * A `Cookie` header with the named cookies removed.
 *
 * Only the copies that are being deleted are dropped; everything else on the
 * request — including a session cookie that is staying — is preserved verbatim.
 */
export function cookieHeaderWithout(
  cookieHeader: string | null | undefined,
  doomed: ReadonlyArray<SessionCookieCopy>,
): string {
  const remove = new Set(doomed.map((copy) => `${copy.name}=${copy.value}`));
  return (cookieHeader ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !remove.has(part))
    .join("; ");
}

/**
 * How many dead copies to clear on this response.
 *
 * Browsers cap the cookies one response may set (Chrome: 180) and, more
 * practically, clearing six things at once on a page load looks like an attack
 * in a network tab. One or two per response clears the realistic case — a
 * single stale twin — and converges over a few page loads if somehow there are
 * more.
 */
export function copiesToClear(dead: ReadonlyArray<SessionCookieCopy>): SessionCookieCopy[] {
  return dead.slice(0, 2);
}

/**
 * The `Set-Cookie` values that delete a copy.
 *
 * A host-only cookie carries no `Domain`; a domain cookie carries one. Removing
 * one requires the identical name, path and domain, so both spellings are
 * emitted and the browser applies whichever matches. A `Set-Cookie` for a
 * cookie the browser does not hold is ignored, so the extra header is free.
 */
export function expirySetCookies(copy: SessionCookieCopy, domains: ReadonlyArray<string | undefined>): string[] {
  const base = [
    `${copy.name}=`,
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
  ];
  return domains.map((domain) => [...base.slice(0, 2), ...(domain ? [`Domain=${domain}`] : []), ...base.slice(2)].join("; "));
}
