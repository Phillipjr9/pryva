-- Shared, atomic fixed-window counters for authentication and purchase routes.
-- Keys are SHA-256 digests so raw email addresses and IPs are not stored here.
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key varchar(64) PRIMARY KEY,
  count integer NOT NULL,
  reset_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limit_buckets_reset_at_idx ON rate_limit_buckets (reset_at);
