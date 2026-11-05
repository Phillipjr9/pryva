-- The two emails a new account never received.
--
-- The flow was: signup mails a confirmation link, the customer clicks it, and
-- that is the last thing they ever hear until money moves. Two gaps followed, and
-- both are the kind nobody reports because there is nothing to report:
--
--   • No receipt for the verification itself. A person who clicks a link is
--     trusting a page they may never see render (a cold session, a different
--     device, a mail client's in-app browser). The one durable artefact that
--     could say "this is done" was never sent.
--   • No welcome. `welcomeEmail()` has existed since launch and no code path has
--     ever called it -- the account went from "confirm your address" to silence.
--
-- Delivery is once-only per account by construction, not by care. Both sends are
-- triggered by `users.email_verified_at` moving from NULL to a timestamp, which
-- happens at most once per account (the confirm transaction writes it with
-- `IS NULL` in the WHERE clause, and an address change clears it and re-confirms
-- separately). This table is the second lock: two callers can race -- the token
-- confirm and the resend route's "already verified" branch -- and a unique index
-- means a race costs a duplicate email attempt, never a duplicate email.
--
-- No address is stored. The user id is the key, and the address is read from
-- `users` at send time so a closed account cannot be mailed.
BEGIN;

CREATE TABLE IF NOT EXISTS "onboarding_email_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  -- 'verified' (the receipt) or 'welcome' (the introduction).
  "kind" varchar(24) NOT NULL,
  -- What the provider said. 'accepted' is all Resend can promise; anything else
  -- is a refusal worth looking at, and it is recorded rather than swallowed.
  "status" varchar(24) NOT NULL DEFAULT 'pending',
  -- The provider's message id, so a later delivery event can be joined to this row.
  "provider_message_id" varchar(100),
  "detail" varchar(200),
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- One row per account per email, ever. The duplicate guard.
CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_email_log_user_kind_idx"
  ON "onboarding_email_log" ("user_id", "kind");
CREATE INDEX IF NOT EXISTS "onboarding_email_log_created_idx"
  ON "onboarding_email_log" ("created_at");

COMMIT;
