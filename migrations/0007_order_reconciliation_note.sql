-- A refund commits first and the provider release is best-effort afterwards, so
-- the customer is always made whole even when we cannot recover the unit. That
-- leaves a real exposure: the money is back in their wallet and the number may
-- still be working in their hands, while the only record of it was a log line
-- nobody reads.
--
-- This column persists that fact on the order so it is visible in the admin
-- orders list. It is a note, not a status: adding a status would change what
-- every status-filtered query and admin view means.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS reconciliation_note text;
