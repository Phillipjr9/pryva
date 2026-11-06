-- Admin-initiated account bans with email confirmation.
--
-- An operator can request that an account be closed. The request does not take
-- effect immediately: a confirmation link is mailed to the account's address,
-- and only when that link is clicked does the account close. This gives the
-- person whose account is at stake a chance to see the notice and act on it,
-- and it means an accidental click by an operator cannot silently remove an
-- account. The identity scrubbing and record retention follow the same rules
-- as self-service closure (see 0024_account_deletions.sql): the row stays so
-- orders, ledger rows, withdrawals and fraud signals can still be read months
-- later.
--
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS "admin_bans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "admin_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE SET NULL,
  "admin_email" varchar(200) NOT NULL,
  "reason" varchar(200),
  -- SHA-256 of the single-use confirmation token. Reading this table never
  -- yields a usable link, matching the pattern of password_reset_tokens and
  -- email_verification_tokens.
  "token_hash" varchar(64) NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "confirmed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "admin_bans_user_idx" ON "admin_bans" ("user_id");
CREATE INDEX IF NOT EXISTS "admin_bans_token_idx" ON "admin_bans" ("token_hash");
CREATE INDEX IF NOT EXISTS "admin_bans_expires_idx" ON "admin_bans" ("expires_at");
