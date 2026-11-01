-- A reviewed payout name, so "contact support" is a path and not a wall.
--
-- Payouts may only go to a bank account whose name matches the name frozen on the
-- first settled deposit. That frozen name is the profile name typed at signup,
-- which is often shorter or spelled differently from the bank record — "Emeka"
-- against "EMEKA CHUKWUEMEKA OKAFOR". The rule is right to be strict; what was
-- missing was a way for a human to look at the evidence and say "same person".
--
-- This table is that decision, recorded rather than implied. It never edits the
-- frozen deposit name: the evidence of what was recorded when the money arrived
-- stays intact, and an approval can be revoked. Only the account name is
-- widened, only for one user, and only by an administrator, whose address is
-- stored here and in the audit log.
BEGIN;

CREATE TABLE IF NOT EXISTS payout_name_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The name an administrator approved, as the bank records it.
  approved_name varchar(200) NOT NULL,
  -- What the frozen depositor name was at the time, for the record. Null when no
  -- deposit had recorded one.
  depositor_name varchar(200),
  reason varchar(500) NOT NULL,
  approved_by_email varchar(320) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by_email varchar(320)
);

-- One live approval per account; revoking keeps the row as history.
CREATE UNIQUE INDEX IF NOT EXISTS payout_name_approvals_live_idx
  ON payout_name_approvals(user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS payout_name_approvals_user_idx ON payout_name_approvals(user_id);

COMMIT;
