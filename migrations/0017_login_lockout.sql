-- Per-account lockout after repeated wrong passwords.
--
-- Why this exists when `login` already has a rate limiter:
--
--   * the limiter's bucket is a fixed window keyed by email *and* by IP. A
--     botnet with one address per attempt never fills the IP bucket, and a slow
--     attacker who waits out each 15-minute window never fills the key bucket
--     either — but the failures still add up against one account;
--   * the lockout is stored on the account, so it survives a deploy, a cold
--     start and a second app instance. The preview store is process-local and
--     deliberately not a production control.
--
-- Two columns rather than a table because the state belongs to exactly one row
-- and must be read in the same query as the password check:
--
--   * `failed_login_attempts` counts consecutive wrong passwords and resets to
--     zero on a successful sign-in and when a lock is set;
--   * `locked_until` is an absolute instant, so no background job is needed to
--     release the account. An expired value means "not locked".
--
-- Nothing is stored about the attempt itself (no IP, no user agent). That data
-- belongs in the audit log with the rest of the operator-visible history, and
-- keeping it here would turn a security control into a tracking table.
--
-- Additive and idempotent, so applying it twice is a no-op.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "failed_login_attempts" integer NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locked_until" timestamp with time zone;

-- Administrators look up locked accounts during a support call, and the sign-in
-- path reads the row by primary key, so this index only serves the admin filter.
CREATE INDEX IF NOT EXISTS "users_locked_until_idx" ON "users" ("locked_until");

COMMENT ON COLUMN "users"."failed_login_attempts" IS
  'Consecutive failed password attempts. Reset on success, on lock, and on password reset.';
COMMENT ON COLUMN "users"."locked_until" IS
  'Sign-in refused until this instant. NULL or in the past means the account is not locked.';
