-- The amount a closing customer gave up, recorded where the close is recorded.
--
-- Closure is now allowed with money in the wallet, on the explicit understanding
-- that the balance is forfeited. That is a decision someone will be asked about
-- later — "I had ₦4,500 in there" — so it is written down next to the closure
-- itself, and the same figure appears in the ledger as a debit, which is what
-- keeps `previous ± amount = balance_after` true for a closed account.
--
-- Zero for every closure that had an empty wallet, and for every row created
-- before this migration.
--
-- Additive and idempotent.

ALTER TABLE "account_deletions" ADD COLUMN IF NOT EXISTS "forfeited" integer NOT NULL DEFAULT 0;
