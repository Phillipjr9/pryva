import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_EMBEDDED,
  getCurrentUser,
} from "@/lib/auth";
import { isArenaPreviewHost, requestProto } from "@/lib/net";

export const dynamic = "force-dynamic";

/**
 * "Am I signed in, and what does the server see?" — a five-second answer for the
 * one failure that looks like a broken button: the login succeeds, the browser
 * refuses to keep the cookie, and every page bounces back to /login.
 *
 * Never returns the session token itself.
 */
export async function GET(request: Request) {
  const [user, jar] = await Promise.all([getCurrentUser(), cookies()]);
  const headerList = request.headers;
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";

  return Response.json(
    {
      signedInAs: user?.email ?? null,
      cookie: {
        firstParty: Boolean(jar.get(SESSION_COOKIE)?.value),
        embedded: Boolean(jar.get(SESSION_COOKIE_EMBEDDED)?.value),
        anySessionCookieSeen: Boolean(
          headerList.get("cookie")?.match(/pryva_session/),
        ),
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
        : headerList.get("cookie")?.match(/pryva_session/)
          ? "A session cookie reached the server but no live session matched it. Sign in again."
          : isArenaPreviewHost(host)
            ? "No session reached the server. Refresh the page and sign in again."
            : "No session cookie was sent. If you just signed in, this browser context may be blocking cookies — try opening the site in its own tab.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
