-- One complete last-known-good value per catalogue, plus a cross-instance lease.
-- Payload is NULL only before the first successful publication. A failed or
-- interrupted refresh therefore cannot replace a usable catalogue with a partial one.
CREATE TABLE IF NOT EXISTS catalog_snapshots (
  key varchar(128) PRIMARY KEY,
  payload jsonb,
  checked_at timestamptz,
  refreshed_at timestamptz,
  lease_owner uuid,
  lease_expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS catalog_snapshots_lease_idx
  ON catalog_snapshots (lease_expires_at)
  WHERE lease_expires_at IS NOT NULL;
