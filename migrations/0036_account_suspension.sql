-- Suspension is reversible and does not delete customer identity or financial
-- records. It is separate from voluntary account closure and requires an admin
-- action, whose audit record is committed with the status change.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "suspended_at" timestamp with time zone;
