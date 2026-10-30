-- Two-factor authentication (TOTP).
--
-- Three tables rather than columns on `users`, because each has a different
-- lifetime and a different failure mode:
--
--   * `user_two_factor` holds the encrypted shared secret. It exists from the
--     moment enrolment starts (enabled_at NULL) so a half-finished enrolment can
--     be resumed or overwritten, and it is the only row that decides whether
--     sign-in needs a second factor.
--   * `two_factor_recovery_codes` holds one-way hashes. Ten codes, single use:
--     a lost phone must not mean a lost account, and support must not have to
--     disable 2FA on a stranger's word.
--   * `two_factor_challenges` holds short-lived sign-in challenges. Only the
--     SHA-256 of the token is stored, so a database read cannot be replayed as a
--     sign-in.
--
-- The secret is stored encrypted (AES-256-GCM) with a key taken from
-- `TWO_FACTOR_KEY`. When that key is absent the feature is unavailable and the
-- code fails closed; a TOTP secret must never be written in plaintext, because a
-- database dump would then hand over the second factor itself.
--
-- Additive and idempotent.
CREATE TABLE IF NOT EXISTS "user_two_factor" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "secret_ciphertext" text NOT NULL,
  -- NULL while enrolment is in progress. Sign-in only demands a code once set.
  "enabled_at" timestamp with time zone,
  -- The last TOTP time-step accepted. A code is valid for up to three steps
  -- (the window), so without this a sniffed code could be replayed inside it.
  "last_used_step" bigint,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "two_factor_recovery_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  -- SHA-256 of the code as displayed. The plaintext is shown once and never stored.
  "code_hash" varchar(64) NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "two_factor_recovery_codes_hash_idx"
  ON "two_factor_recovery_codes" ("user_id", "code_hash");
CREATE INDEX IF NOT EXISTS "two_factor_recovery_codes_user_idx"
  ON "two_factor_recovery_codes" ("user_id");

CREATE TABLE IF NOT EXISTS "two_factor_challenges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "token_hash" varchar(64) NOT NULL UNIQUE,
  -- Incremented on every wrong code; five is the ceiling before the challenge dies.
  "attempts" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "two_factor_challenges_user_idx"
  ON "two_factor_challenges" ("user_id");
CREATE INDEX IF NOT EXISTS "two_factor_challenges_expires_idx"
  ON "two_factor_challenges" ("expires_at");
