-- Legacy requests remain NULL. New requests use a customer-scoped UUID and
-- retain the chosen account's id even after a bank account is removed.
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS request_id uuid;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS bank_account_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_user_request_idx
  ON withdrawals (user_id, request_id);
