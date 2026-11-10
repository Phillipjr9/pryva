-- Confirmation codes are never persisted. This claim prevents concurrent or
-- ambiguous submissions from being retried as though they were never sent.
ALTER TABLE foxreload_quotes ADD COLUMN IF NOT EXISTS client_code_state varchar(16);
ALTER TABLE foxreload_quotes ADD CONSTRAINT foxreload_client_code_state_check
  CHECK (client_code_state IS NULL OR client_code_state IN ('pending', 'submitted', 'uncertain'));
