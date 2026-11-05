import { isAdminUser, type PublicUser } from "@/lib/auth";

/**
 * Where an administrator starts, and where a customer starts.
 *
 * The two dashboards are separate destinations with separate chrome, so the
 * decision has to be made in one place: `/login` shows a customer the storefront
 * and an administrator the console, and `/admin/login` sends a customer away. If
 * each surface decided for itself the three would drift.
 *
 * This is a convenience, never a control. `/admin` re-checks the same rule on every
 * request through `requireAdmin`, so sending a customer to `/dashboard` here
 * grants nothing they did not already have, and sending an administrator to
 * `/admin` is only useful because they were going to be allowed in anyway.
 */
export function operatorHomeFor(user: PublicUser | null): "/admin" | "/dashboard" {
  return isAdminUser(user) ? "/admin" : "/dashboard";
}
