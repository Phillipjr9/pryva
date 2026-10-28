-- Existing in-flight transfers keep NULL: their provider references must be
-- reconciled manually rather than inferred or replaced. New approvals save a
-- Paystack-compatible reference before making the provider request.
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS paystack_reference varchar(50);
CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_paystack_reference_idx
  ON withdrawals (paystack_reference);
