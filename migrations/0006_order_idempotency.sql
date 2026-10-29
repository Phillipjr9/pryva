-- A purchase is fulfil-first-then-debit, so a retried request used to buy a
-- second real number and charge the customer for it again. Frequency limiting
-- and a disabled submit button stop a double click, but not a browser retry, a
-- second tab, or a resubmit after a timeout whose first attempt succeeded.
--
-- The client now sends one UUID per purchase attempt, stable across a retry of
-- that attempt and fresh for a genuinely new purchase. Buying the same plan
-- twice in a row is legitimate, so a time-based dedupe would be wrong.
--
-- Legacy rows stay NULL; Postgres treats NULLs as distinct, so the unique index
-- does not collide on them. Mirrors 0003_withdrawal_idempotency.sql.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS orders_user_request_idx
  ON orders (user_id, request_id);
