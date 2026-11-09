-- A batch owns an immutable basket and one uniquely claimed order per unit.
-- No supplier call may start before the batch and every wallet debit commit.
CREATE TABLE IF NOT EXISTS bulk_batches (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  intent_hash varchar(64) NOT NULL,
  total integer NOT NULL,
  unit_count integer NOT NULL,
  status varchar(24) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bulk_batches_user_request_idx ON bulk_batches (user_id, request_id);

-- Receipt lookups and operator reconciliation group units by immutable batch ID.
CREATE INDEX IF NOT EXISTS orders_bulk_batch_lookup_idx ON orders (user_id, request_intent) WHERE request_intent LIKE 'bulk:%';
