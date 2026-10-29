/**
 * The last remaining preview gate: whether the app is running against the
 * in-memory database shim instead of a real Postgres.
 *
 * Everything else that used to live here described the shared demo account
 * (`demo@pryva.ng`, its welcome credit, its view-only profile). That account no
 * longer exists, so those helpers were deleted rather than left returning
 * `false` forever — a guard that can never fire is indistinguishable from a
 * guard nobody remembered to remove.
 *
 * This one is different: it is a real environment check with 40+ callers, and it
 * stays until the in-memory shim in `src/db/index.ts` is retired in favour of a
 * mandatory database connection.
 *
 * It asks `persistentDatabaseConfigured()` rather than testing DATABASE_URL
 * directly, because Aurora provisioned through the Vercel AWS integration has no
 * DATABASE_URL at all -- it authenticates with IAM tokens. Testing only for
 * DATABASE_URL classified a correctly wired production database as preview,
 * which meant the in-memory shim answered queries and the demo account was
 * treated as the live data model.
 */

import { persistentDatabaseConfigured } from "@/lib/database-config";
export function isPreviewDatabase(): boolean {
  return !persistentDatabaseConfigured();
}
