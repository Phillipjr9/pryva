import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_EMBEDDED,
  getCurrentUser,
} from "@/lib/identity/auth";
import { isArenaPreviewHost, requestProto } from "@/lib/platform/net";

export const dynamic = "force-dynamic";

/**
 * "Am I signed in, and what does the server see?" — a five-second answer for the
 * one failure that looks like a broken button: the login succeeds, the browser
 * refuses to keep the cookie, and every page bounces back to /login.
 *
 * Never returns the session token itself.
 */
/**
 * How many cookies of each session name the browser actually sent.
 *
 * A name can legitimately appear more than once: a cookie written before the
 * site moved to its own domain is host-only, and one written afterwards carries
 * `Domain=pryvalogs.com`. They are different cookies to the browser, so signing
 * in does not necessarily replace the older one — it adds beside it. Next keeps
 * only one of them, so if the copy it keeps is the dead one, every page reports
 * "signed out" while the browser is demonstrably sending a session cookie.
 *
 * Counts only. The token is never returned, and neither is any value.
 */
function sessionCookieCopies(rawCookieHeader: string | null): {
  firstParty: number;
  embedded: number;
} {
  const counts = { firstParty: 0, embedded: 0 };
  for (const part of (rawCookieHeader ?? "").split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name === SESSION_COOKIE) counts.firstParty += 1;
    if (name === SESSION_COOKIE_EMBEDDED) counts.embedded += 1;
  }
  return counts;
}

export async function GET(request: Request) {
  const [user, jar] = await Promise.all([getCurrentUser(), cookies()]);
  const headerList = request.headers;
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const copies = sessionCookieCopies(headerList.get("cookie"));
  const duplicateSessionCookies = copies.firstParty > 1 || copies.embedded > 1;

  return Response.json(
    {
      signedInAs: user?.email ?? null,
      cookie: {
        firstParty: Boolean(jar.get(SESSION_COOKIE)?.value),
        embedded: Boolean(jar.get(SESSION_COOKIE_EMBEDDED)?.value),
        anySessionCookieSeen: Boolean(
          headerList.get("cookie")?.match(/pryva_session/),
        ),
        // `copies` above 1 on a signed-out answer is the diagnosis: the browser
        // is holding a stale session cookie and it shadows the live one.
        copies,
        duplicateSessionCookies,
      },
      request: {
        proto: requestProto(request),
        host: host || null,
        forwardedProto: headerList.get("x-forwarded-proto") ?? null,
        secFetchSite: headerList.get("sec-fetch-site") ?? null,
        secFetchDest: headerList.get("sec-fetch-dest") ?? null,
      },
      hint: user
        ? "Session is healthy — cookies round-trip in this browser context."
        : duplicateSessionCookies
          ? "This browser is holding more than one session cookie of the same name, and the older one is being read instead of the new one. Signing in again will not fix it — clear this site's cookies and sign in once."
          : headerList.get("cookie")?.match(/pryva_session/)
            ? "A session cookie reached the server but no live session matched it. Sign in again."
            : isArenaPreviewHost(host)
              ? "No session reached the server. Refresh the page and sign in again."
              : "No session cookie was sent. If you just signed in, this browser context may be blocking cookies — try opening the site in its own tab.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
