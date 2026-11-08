BEGIN;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS code_received_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS orders_code_received_at_idx ON orders(code_received_at);

COMMIT;
