import { timingSafeEqual } from "node:crypto";
import { getCurrentUser, isAdminUser, type PublicUser } from "@/lib/auth";
import { ADMIN_2FA_MESSAGE, adminBlockedForMissingSecondFactor } from "@/lib/admin-two-factor";
import { isSameOriginMutation } from "@/lib/net";

type AdminAccess =
  | { user: PublicUser; response: null }
  | { user: null; response: Response };

function denied(message: string, status: number): AdminAccess {
  return {
    user: null,
    response: Response.json(
      { ok: false, error: message },
      { status, headers: { "Cache-Control": "no-store" } },
    ),
  };
}

/** API counterpart to requireAdmin: never redirects or leaks privileged data. */
export async function authorizeAdminApi(request: Request): Promise<AdminAccess> {
  const user = await getCurrentUser();
  if (!user) return denied("Authentication required", 401);
  if (!isAdminUser(user)) return denied("Administrator access required", 403);
  if (!isSameOriginMutation(request)) return denied("Cross-origin request denied", 403);
  // Same rule as the pages: an admin without a second factor cannot call the
  // endpoints that move money either, or the page redirect would be theatre.
  if (await adminBlockedForMissingSecondFactor(user.id)) return denied(ADMIN_2FA_MESSAGE, 403);
  return { user, response: null };
}

/**
 * Which credential a read is answered with.
 *
 * The operator console is hosted apart from the app, so it can never present the
 * signed-in administrator's session cookie. It presents a bearer instead, and that
 * bearer opens GETs and nothing else. It is a third credential on purpose:
 * `CRON_SECRET` fires refunds and credits wallets, `DIAGNOSTICS_SECRET` probes
 * suppliers, and a token handed to a dashboard has to be revocable without
 * silently changing either of those. Compare
 * `src/lib/diagnostics-auth.ts`, which split for the same reason.
 */
type ReadAccess =
  | { user: PublicUser | null; response: null }
  | { user: null; response: Response };

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const value = header.slice("Bearer ".length).trim();
  return value || null;
}

/** False when nothing is configured, so an unset variable cannot match anything. */
function readTokenMatches(presented: string): boolean {
  const configured = process.env.OPERATOR_READ_TOKEN?.trim();
  if (!configured) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(configured);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Read counterpart to `authorizeAdminApi`: the operator's session, or a read token.
 *
 * A request that carries a bearer is answered by the bearer alone and never falls
 * back to the cookie, so a client with a wrong or stale token is told so instead of
 * quietly being treated as whatever session happens to be in its jar. `user` is null
 * when a token was used: the caller has no person behind it, so anything that would
 * record an actor has to refuse. Routes project their own columns, and a route that
 * returns a credential -- an OTP, an activation code, a live gift-card code, a bulk
 * export -- is deliberately left on `authorizeAdminApi` rather than opened here.
 */
export async function authorizeAdminRead(request: Request): Promise<ReadAccess> {
  const token = bearer(request);
  if (!token) {
    const access = await authorizeAdminApi(request);
    return access.response
      ? { user: null, response: access.response }
      : { user: access.user, response: null };
  }
  if (request.method.toUpperCase() !== "GET" && request.method.toUpperCase() !== "HEAD") {
    return denied("The read credential cannot change anything", 403);
  }
  if (!readTokenMatches(token)) return denied("Invalid read credential", 401);
  return { user: null, response: null };
}
