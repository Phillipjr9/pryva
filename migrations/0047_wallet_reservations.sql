-- Durable wallet holds, so a paid supplier call can never outrun the customer's money.
--
-- Before this table, every purchase path did the same three things in the same
-- order: read `users.wallet_balance`, decide it was enough, call the supplier, and
-- debit afterwards. Two concurrent requests both read the same balance, both
-- passed, and both spent: the supplier charged us twice and only one debit could
-- succeed. The wallet was the thing that was wrong afterwards, not the supplier.
--
-- A hold fixes that without taking the money early. Reserving moves funds from
-- `wallet_balance` to `wallet_reserved` in one atomic UPDATE, so a second request
-- sees a smaller available balance and is refused before it can spend anything.
-- The money is still the customer's until the supplier confirms a delivery; at
-- that point `settle` turns the hold into the real debit + ledger row, and a
-- definitive supplier refusal `release`s it back. Anything the path cannot
-- classify stays `held`/`review` for a human — never auto-released, never
-- auto-retried.
--
-- Status vocabulary (the only four values):
--   held      funds reserved, outcome not yet known          (auto-releasable only by its own path)
--   settled   supplier delivered; the hold became a debit     (terminal)
--   released  definitive failure before any spend             (terminal)
--   review    outcome unknown; a human must reconcile         (terminal until an operator acts)
--
-- `wallet_reserved` on `users` is a derived total, kept in the same UPDATE as the
-- balance so the two can never disagree within a committed transaction. It is
-- what makes "available balance" a single number every reader can use.
CREATE TABLE IF NOT EXISTS wallet_reservations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Client-supplied, one per purchase attempt. Unique per user: a retried
  -- request replays the same hold instead of reserving a second time.
  request_id uuid NOT NULL,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  service varchar(40) NOT NULL,
  amount integer NOT NULL,
  status varchar(24) NOT NULL,
  -- What was reserved for: offer/plan + price + terms. A retry with a different
  -- basket must not reuse an existing hold, so the fingerprint is compared.
  fingerprint varchar(160) NOT NULL,
  -- When the path that owns the hold should have finished with it. Expiry is
  -- recorded for the nightly report only; it never releases funds by itself.
  expires_at timestamptz,
  settled_at timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS wallet_reservations_user_request_idx
  ON wallet_reservations (user_id, request_id);

-- The hot read is "which holds are open for this user" (available balance,
-- account closure, withdrawal eligibility). Partial, because settled and
-- released rows are history and would only bloat it.
CREATE INDEX IF NOT EXISTS wallet_reservations_open_idx
  ON wallet_reservations (user_id)
  WHERE status IN ('held', 'review');

CREATE INDEX IF NOT EXISTS wallet_reservations_expiry_idx
  ON wallet_reservations (expires_at)
  WHERE status = 'held';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wallet_reservations_amount_positive'
  ) THEN
    ALTER TABLE wallet_reservations
      ADD CONSTRAINT wallet_reservations_amount_positive CHECK (amount > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wallet_reservations_status_known'
  ) THEN
    ALTER TABLE wallet_reservations
      ADD CONSTRAINT wallet_reservations_status_known
      CHECK (status IN ('held', 'settled', 'released', 'review'));
  END IF;
END
$$;

-- Funds that are committed to an in-flight order but not yet spent. Never
-- negative: the reserve UPDATE only moves money it can see, and every settle or
-- release removes exactly what one hold added.
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_reserved integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_wallet_reserved_nonnegative'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_wallet_reserved_nonnegative CHECK (wallet_reserved >= 0);
  END IF;
END
$$;
