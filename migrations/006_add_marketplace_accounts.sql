-- 005_add_marketplace_accounts
-- Stores marketplace-delivered credentials on the order that bought them.
-- One row per order; `accounts` is a JSON array of raw credential strings
-- exactly as the supplier returned them (formats vary per listing).

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS accounts text;

-- Fast lookup when reconciling marketplace orders against the provider.
CREATE INDEX IF NOT EXISTS orders_provider_request_idx
  ON orders (provider, provider_request_id);
