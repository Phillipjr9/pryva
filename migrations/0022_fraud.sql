-- Fraud signals, and the queue an operator reads.
--
-- `account_signals` is what makes multi-accounting visible at all: the network an
-- account was created from, stored as a **salted hash**. The raw address is never
-- written down. A hash is enough to answer the only question this platform needs
-- ("did these two accounts arrive from the same place?"), and it cannot be turned
-- back into a customer's location by anyone reading a backup.
--
-- `fraud_events` is the paper trail: one row per thing that looked wrong, with the
-- reasons spelled out in words an operator can act on, the amount or reference it
-- concerned, and who reviewed it and when. It is deliberately a log, not a policy
-- engine: no automated action reads it back, so a false positive costs a customer
-- nothing.
--
-- `withdrawals.risk_level` / `risk_reasons` is advisory and defaulted to 'low', so
-- existing rows keep their meaning and no payout path changes behaviour because a
-- migration ran. An operator sees the flag in the queue; the money flow is
-- untouched.
--
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS "account_signals" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "ip_hash" varchar(64),
  "user_agent_hash" varchar(64),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "account_signals_ip_idx" ON "account_signals" ("ip_hash");

CREATE TABLE IF NOT EXISTS "fraud_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "kind" varchar(40) NOT NULL,
  "severity" varchar(16) NOT NULL DEFAULT 'warn',
  "reasons" text NOT NULL,
  "amount" integer,
  "reference" varchar(64),
  "ip_hash" varchar(64),
  "reviewed_at" timestamp with time zone,
  "reviewed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "fraud_events_user_idx" ON "fraud_events" ("user_id");
CREATE INDEX IF NOT EXISTS "fraud_events_kind_idx" ON "fraud_events" ("kind");
CREATE INDEX IF NOT EXISTS "fraud_events_created_idx" ON "fraud_events" ("created_at");

-- The queue is "unreviewed, newest first"; a partial index keeps that cheap as the
-- log grows, without indexing the rows an operator has already dealt with.
CREATE INDEX IF NOT EXISTS "fraud_events_open_idx"
  ON "fraud_events" ("created_at")
  WHERE "reviewed_at" IS NULL;

ALTER TABLE "withdrawals" ADD COLUMN IF NOT EXISTS "risk_level" varchar(16) NOT NULL DEFAULT 'low';
ALTER TABLE "withdrawals" ADD COLUMN IF NOT EXISTS "risk_reasons" text;

COMMENT ON TABLE "account_signals" IS
  'Where an account was created from, as salted hashes. Never a raw IP address.';
COMMENT ON COLUMN "fraud_events"."kind" IS
  'withdrawal_review | referral_same_network | purchase_velocity | gift_card_velocity | withdrawal_velocity';
COMMENT ON COLUMN "fraud_events"."severity" IS
  'info | warn | high. Advisory only: no automated action reads this table back.';
COMMENT ON COLUMN "withdrawals"."risk_level" IS
  'low | warn | high. Advisory flag for the admin queue; the payout flow itself is unchanged.';
COMMENT ON COLUMN "withdrawals"."risk_reasons" IS
  'Why this request was flagged, in words: e.g. "new payout account; account is 3 days old".';
