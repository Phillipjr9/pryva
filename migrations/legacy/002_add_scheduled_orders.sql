-- Scheduled orders table
CREATE TABLE IF NOT EXISTS scheduled_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service VARCHAR(40) NOT NULL,
  product_slug VARCHAR(80) NOT NULL,
  frequency VARCHAR(24) NOT NULL,
  next_run_at TIMESTAMPTZ NOT NULL,
  last_run_at TIMESTAMPTZ,
  last_order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scheduled_orders_user_idx ON scheduled_orders(user_id);
CREATE INDEX IF NOT EXISTS scheduled_orders_next_run_idx ON scheduled_orders(next_run_at);
CREATE INDEX IF NOT EXISTS scheduled_orders_status_idx ON scheduled_orders(status);
