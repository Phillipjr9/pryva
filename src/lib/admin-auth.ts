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
