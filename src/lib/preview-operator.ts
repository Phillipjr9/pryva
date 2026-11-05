import { isPreviewDatabase } from "@/lib/demo-policy";

/**
 * Preview-only operator bootstrap.
 *
 * ## The problem this solves
 *
 * Administrator access requires a **verified** address: `isAdminUser` demands
 * `emailVerifiedAt`, and the only writer of that column is the token consumer
 * behind a real verification email. The in-memory preview has no mail service, and
 * signup deliberately refuses addresses listed in `ADMIN_EMAILS` — so on a preview
 * there is no sequence of clicks that produces an administrator. The console is
 * unreachable by design, which is fine for customers and useless for reviewing the
 * console itself.
 *
 * ## The two locks
 *
 * It takes **both** of these, and either one alone is enough to keep it off:
 *
 *   1. `PREVIEW_OPERATOR=1` — an explicit opt-in. Absent by default, so a normal
 *      deployment never has it.
 *   2. An in-memory database — `isPreviewDatabase()`, the same check that decides
 *      whether the demo shim answers queries at all. A deployment pointed at real
 *      Postgres is never a preview, whatever the first lock says.
 *
 * So a production deploy that lost its database configuration *and* happened to
 * carry the flag still needs both to be true together; and the flag being absent
 * means the database check is never even consulted.
 *
 * ## What it does and does not widen
 *
 * It lets an address listed in `ADMIN_EMAILS` be created through signup on a
 * preview and be treated as verified, so the operator can sign in and look at
 * `/admin`. It does not grant administrator rights to anybody who is not already
 * in `ADMIN_EMAILS` — that list stays the only source of administrator identity,
 * and an empty list still means nobody is an administrator.
 */
export function previewOperatorBootstrapEnabled(): boolean {
  if (process.env.PREVIEW_OPERATOR !== "1") return false;
  return isPreviewDatabase();
}
