-- Closing an account without destroying the record of what it did.
--
-- Self-service deletion used to answer 503: `users` cascades to orders, wallet
-- transactions, withdrawals, gift cards and payment records, so the only
-- implementation available was "erase the financial history", which is not
-- something this platform may do. Chargebacks, refunds, supplier disputes and
-- fraud investigations all read those rows months later, and a customer's request
-- to leave is not a request to delete the evidence that they were ever billed.
--
-- So deletion is a *tombstone*, not a cascading delete:
--
--   * identity is scrubbed — name, email, password hash, Google subject, email
--     verification, second factor, passkeys and every session go;
--   * the row stays, because 20+ tables point at it, and the ledger invariant the
--     nightly reconciliation checks (`previous ± amount = balance_after`, last row
--     equals `users.wallet_balance`) must keep holding for a closed account;
--   * `deleted_at` is what every auth path now reads, so a closed account can
--     never be signed into again even if a session row somehow survived.
--
-- `deleted_email_hash` is a salted one-way fingerprint of the address the account
-- used, kept for one purpose only: if the person writes in about a payout months
-- later, support can match them by hashing the address they name. It is the same
-- construction as the fraud signals (`FRAUD_HASH_SALT`), and without the salt it
-- cannot be turned back into an address.
--
-- `account_deletions` is the receipt: when it happened, why, what was kept (counts,
-- not contents) and where the request came from. It exists so "we kept records"
-- is an auditable statement rather than a policy in a document.
--
-- Additive and idempotent.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_email_hash" varchar(64);

CREATE INDEX IF NOT EXISTS "users_deleted_idx" ON "users" ("deleted_at");

CREATE TABLE IF NOT EXISTS "account_deletions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "deleted_at" timestamp with time zone NOT NULL DEFAULT now(),
  "reason" varchar(40) NOT NULL DEFAULT 'self_service',
  -- Counts of what was retained, e.g. {"orders":3,"walletTransactions":5}.
  -- Never a copy of the rows themselves.
  "retained" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "ip_hash" varchar(64)
);

CREATE INDEX IF NOT EXISTS "account_deletions_user_idx" ON "account_deletions" ("user_id");
CREATE INDEX IF NOT EXISTS "account_deletions_deleted_idx" ON "account_deletions" ("deleted_at");
