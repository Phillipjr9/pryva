-- Rotate uncertain refund candidates instead of repeatedly selecting the first
-- 100. This timestamp is not proof of supplier outcome and grants no refund.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_checked_at timestamptz;
CREATE INDEX IF NOT EXISTS orders_refund_check_fairness_idx
  ON orders (refund_checked_at, created_at, id)
  WHERE service = 'numbers' AND status IN ('active', 'expired') AND refunded_at IS NULL AND otp_code IS NULL;

-- Bind new number-order idempotency keys to their exact checkout intent.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS request_intent varchar(160);
