-- Referrals: one invite code per account, one reward per invited account.
--
-- `referral_codes` is a table rather than a column on `users` so a code can be
-- minted the first time somebody opens the invite page and never be recomputed:
-- a deterministic code derived from a user id is fine until the derivation has
-- to change, and then every link already shared breaks.
--
-- `referrals` records the attribution and the payout in one row. `referee_id` is
-- UNIQUE, which is what makes "one reward per invited account" true in the
-- database rather than in a code path that a retry can skip. `status` is
-- pending | credited | void; `reward_reference` is the wallet ledger reference and
-- is UNIQUE so the credit itself cannot be applied twice even if two workers
-- settle the same row.
--
-- The reward is a percentage of the referee's first delivered order, capped. The
-- percentage and cap live in the environment (REFERRAL_REWARD_PERCENT,
-- REFERRAL_REWARD_CAP_NGN) with the owner-approved defaults written into the
-- application, so changing either is a configuration change, not a migration.
--
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS "referral_codes" (
  "code" varchar(16) PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "referrals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "referrer_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "referee_id" uuid NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "code" varchar(16) NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'pending',
  "qualifying_order_id" uuid REFERENCES "orders"("id") ON DELETE SET NULL,
  "reward_amount" integer,
  "reward_reference" varchar(64) UNIQUE,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "credited_at" timestamp with time zone,
  CONSTRAINT "referrals_no_self" CHECK ("referrer_id" <> "referee_id")
);

CREATE INDEX IF NOT EXISTS "referrals_referrer_idx" ON "referrals" ("referrer_id");
CREATE INDEX IF NOT EXISTS "referrals_status_idx" ON "referrals" ("status");

COMMENT ON COLUMN "referrals"."status" IS
  'pending | credited | void — pending until the referee has a delivered, unrefunded first order.';
COMMENT ON COLUMN "referrals"."reward_amount" IS
  'Naira credited to the referrer: REFERRAL_REWARD_PERCENT of the qualifying order, capped by REFERRAL_REWARD_CAP_NGN.';
COMMENT ON COLUMN "referrals"."reward_reference" IS
  'Wallet ledger reference for the credit. UNIQUE, so the reward cannot be paid twice.';
COMMENT ON COLUMN "referrals"."qualifying_order_id" IS
  'The referee order that unlocked the reward. Kept so the payout can be explained later.';
