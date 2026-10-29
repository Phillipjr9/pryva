-- Email verification.
--
-- Signup accepted any address with no proof of control. That is survivable for an
-- ordinary account, but ADMIN_EMAILS grants privilege by string match against the
-- address on the row -- so on a public site, anyone could register a configured
-- administrator's address and inherit their access. Verification is what makes
-- that match mean something.
--
-- Tokens follow password_reset_tokens: only a SHA-256 hash is stored, so reading
-- this table never yields a usable link, and issuing a new token supersedes any
-- outstanding one.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamp with time zone;

CREATE TABLE IF NOT EXISTS "email_verification_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "token_hash" varchar(64) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "email_verification_tokens_hash_idx"
  ON "email_verification_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "email_verification_tokens_user_idx"
  ON "email_verification_tokens" ("user_id");

-- Existing users are left NULL on purpose. Marking them verified would assert a
-- fact nobody established, and would hand administrator access to anyone already
-- squatting on a configured address. They verify like everyone else.
