/**
 * The single source of truth for "is a persistent database configured?".
 *
 * This module deliberately imports nothing. `isPreviewDatabase()` has 40+
 * callers across server and client components, and the connection pool lives in
 * `src/db/index.ts` which imports `pg`. Keeping the predicate separate means a
 * client component can ask the question without dragging a Postgres driver into
 * the browser bundle.
 *
 * Two ways to configure a database are supported:
 *
 * 1. `DATABASE_URL` -- a connection string with a password in it.
 * 2. The Vercel AWS Marketplace integration, which provisions Aurora Postgres
 *    with OIDC federation and RDS IAM authentication. It sets PGHOST, PGPORT,
 *    PGUSER, PGDATABASE, PGSSLMODE, AWS_REGION, AWS_ROLE_ARN and
 *    AWS_RESOURCE_ARN -- and never sets a password or a DATABASE_URL, because
 *    the password is a short-lived token minted per connection. See
 *    `src/db/aws-iam.ts`.
 *
 * Before this module existed the check was `!process.env.DATABASE_URL`, so an
 * app correctly wired to Aurora via IAM was still classified as preview: the
 * in-memory shim answered queries and the shared demo account -- known password,
 * seeded wallet balance -- was treated as the live data model.
 */

/** True when the four variables RDS IAM authentication cannot work without. */
export function awsIamConfigured(): boolean {
  return Boolean(
    process.env.PGHOST?.trim() &&
      process.env.PGUSER?.trim() &&
      process.env.AWS_REGION?.trim() &&
      process.env.AWS_ROLE_ARN?.trim(),
  );
}

export function databaseUrlConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

/** True when queries should reach a real Postgres rather than the shim. */
export function persistentDatabaseConfigured(): boolean {
  return databaseUrlConfigured() || awsIamConfigured();
}
