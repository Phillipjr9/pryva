-- Passkeys.
--
-- A passkey is a WebAuthn credential: the private key never leaves the
-- customer's device, and this table stores only the public half plus the counter
-- that lets the library detect a cloned authenticator.
--
-- `public_key` is text (base64url COSE) rather than bytea. It is not a secret,
-- and a string keeps every layer — including the in-memory preview adapter —
-- free of driver-specific binary codecs.
--
-- `webauthn_challenges` holds the value a ceremony has to sign. It is
-- server-side and single-use: a challenge the client chose, or one that can be
-- spent twice, makes a signature replayable. Sign-in deletes nothing; it marks
-- `consumed_at` with a conditional update, so the row is also a short audit trail
-- of attempts that were started and never finished.
--
-- Additive and idempotent.
CREATE TABLE IF NOT EXISTS "webauthn_credentials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "credential_id" text NOT NULL,
  "public_key" text NOT NULL,
  "counter" integer NOT NULL DEFAULT 0,
  "transports" varchar(120),
  "device_type" varchar(24),
  "backed_up" boolean NOT NULL DEFAULT false,
  "label" varchar(80),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_used_at" timestamp with time zone,
  CONSTRAINT "webauthn_credentials_credential_id_unique" UNIQUE ("credential_id")
);

CREATE INDEX IF NOT EXISTS "webauthn_credentials_user_idx" ON "webauthn_credentials" ("user_id");

CREATE TABLE IF NOT EXISTS "webauthn_challenges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "purpose" varchar(16) NOT NULL,
  "challenge" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "webauthn_challenges_challenge_idx" ON "webauthn_challenges" ("challenge");

COMMENT ON COLUMN "webauthn_credentials"."counter" IS
  'Authenticator signature counter. A value that does not move forward means the credential was cloned.';
COMMENT ON COLUMN "webauthn_challenges"."purpose" IS
  'register | authenticate. A challenge issued for one ceremony is useless for the other.';
COMMENT ON COLUMN "webauthn_challenges"."consumed_at" IS
  'Set once, atomically. A challenge that can be spent twice makes an assertion replayable.';
