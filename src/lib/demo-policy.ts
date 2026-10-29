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
 * mandatory `DATABASE_URL`.
 */
export function isPreviewDatabase(): boolean {
  return !process.env.DATABASE_URL?.trim();
}
