-- Indexes for the queries that read a whole table to answer a small question.
--
-- Every statement below is additive and idempotent: no column changes, nothing
-- dropped, and the application that is live while this runs neither knows nor
-- cares that the indexes exist. Each one is here because a query in the code
-- filters or sorts on exactly these columns and, without the index, PostgreSQL
-- answers it with a sequential scan that grows with the life of the business
-- rather than with the size of the answer.
--
-- On a large table, build these by hand first so writes are not blocked while
-- the index is created (this runner wraps each file in a transaction, and
-- CREATE INDEX CONCURRENTLY cannot run inside one):
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_status_created_idx ON orders (status, created_at);
--   ... and so on for each index below, with the same name and definition.
--
-- IF NOT EXISTS then makes this file a no-op for whatever was built already.

-- The sweeps that keep orders moving all ask for "orders in an open state":
-- codes still awaited (status = 'active'), eSIMs and top-ups still being issued
-- ('processing'), supplier outcomes under review ('review'), rentals to expire.
-- Open orders are a sliver of the table; delivered and refunded ones are the
-- rest of it. Leading with status lets each sweep read only the sliver, and
-- created_at serves the cut-offs and oldest-first ordering those sweeps use.
-- The console's "delivered in this window" totals use the same two columns.
CREATE INDEX IF NOT EXISTS orders_status_created_idx ON orders (status, created_at);

-- Newest-first listings and "how many in this window" counts over every order:
-- the console's order list, its dashboard tiles and the daily reconciliation.
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders (created_at);

-- "Which ledger rows belong to this order?" is asked before every refund and on
-- every order page, by order id alone. It is also what PostgreSQL itself asks
-- when an order row is deleted (order_id is ON DELETE SET NULL), once per order.
-- Top-ups, payouts and gift cards carry no order, so those rows are left out.
CREATE INDEX IF NOT EXISTS wallet_transactions_order_idx ON wallet_transactions (order_id)
  WHERE order_id IS NOT NULL;

-- Newest-first ledger pages and per-window totals: the console's transaction
-- list, analytics, exports and the daily reconciliation.
CREATE INDEX IF NOT EXISTS wallet_transactions_created_idx ON wallet_transactions (created_at);

-- "How many accounts were created in the last hour?" runs after every signup
-- (the signup-spike alert), and the console lists the newest accounts first.
CREATE INDEX IF NOT EXISTS users_created_idx ON users (created_at);
