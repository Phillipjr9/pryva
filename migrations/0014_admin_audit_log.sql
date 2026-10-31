-- An append-only record of privileged admin actions.
--
-- Before this, a refund, a withdrawal approval or a delivery left a line in the
-- application log and nothing in the database. Logs rotate, are not queryable by
-- an operator in the console, and are not evidence in a dispute with a customer
-- or a supplier. This table is the durable record of *who* moved money and *what*
-- they did to an account.
--
-- Two deliberate choices:
--
--   * `actor_email` is copied, not joined. An email is the identity a human
--     recognises, and the account it came from may be renamed or removed; the
--     record must keep saying what was true when the action ran. `actor_id` is
--     still kept (and set to NULL on delete) so entries can be grouped by person.
--   * `target_id` is text and not a foreign key, because targets live in several
--     tables (`orders`, `withdrawals`, `users`, `contact_messages`, `gift_cards`)
--     and a refunded order must not lose its audit trail when anything is pruned.
--
-- `summary` is written already redacted: no credentials, no verification codes,
-- no full bank account numbers. This table is read by administrators, and the
-- same rule that keeps those values out of logs keeps them out of here.
--
-- Additive and idempotent, so applying it twice is a no-op.
CREATE TABLE IF NOT EXISTS "admin_audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "actor_email" varchar(200) NOT NULL,
  -- Dotted verbs such as 'withdrawal.approve', so filtering stays stable.
  "action" varchar(64) NOT NULL,
  -- 'order' | 'withdrawal' | 'user' | 'message' | 'gift_card'
  "target_type" varchar(32) NOT NULL,
  "target_id" varchar(191) NOT NULL,
  "summary" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "admin_audit_log_created_idx" ON "admin_audit_log" ("created_at");
CREATE INDEX IF NOT EXISTS "admin_audit_log_actor_idx" ON "admin_audit_log" ("actor_id");
CREATE INDEX IF NOT EXISTS "admin_audit_log_target_idx" ON "admin_audit_log" ("target_type", "target_id");
