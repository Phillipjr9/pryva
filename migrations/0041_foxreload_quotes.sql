-- One immutable, short-lived retail quote may be consumed by at most one order.
CREATE TABLE IF NOT EXISTS foxreload_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id varchar(64) NOT NULL,
  product_name varchar(160) NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
  wholesale_total varchar(32) NOT NULL,
  currency varchar(3) NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  expires_at timestamptz NOT NULL,
  order_id uuid REFERENCES orders(id),
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS foxreload_quotes_expiry_idx ON foxreload_quotes (expires_at);
