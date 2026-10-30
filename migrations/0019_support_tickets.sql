-- A support conversation, rather than a support form submission.
--
-- `contact_messages` stays as it is: the public form is anonymous and one-way,
-- and turning it into a thread would mean inventing an owner for messages that
-- have none. These two tables are the signed-in conversation: a ticket the
-- customer can add to, and the messages in it from the customer, the assistant
-- and (when it is escalated) a person.
--
-- `status` says who the ball is with: open | waiting_on_customer | escalated |
-- resolved | closed. `handled_by` says who finished it, so "the assistant
-- resolved this much on its own" is measurable rather than asserted.
--
-- `support_messages.trace` is the assistant's reasoning for its own reply —
-- evidence read, options scored, action taken, whether the fix verified. It is
-- admin-visible and never rendered to the customer, which is why it is a column
-- here rather than being folded into `body`.
--
-- Additive and idempotent.
CREATE TABLE IF NOT EXISTS "support_tickets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "subject" varchar(160) NOT NULL,
  "category" varchar(40) NOT NULL DEFAULT 'other',
  "status" varchar(24) NOT NULL DEFAULT 'open',
  "priority" varchar(16) NOT NULL DEFAULT 'normal',
  "channel" varchar(16) NOT NULL DEFAULT 'dashboard',
  "handled_by" varchar(16),
  "assigned_admin_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "assistant_confidence" integer,
  "escalated_at" timestamp with time zone,
  "resolved_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "last_activity_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "support_tickets_user_idx" ON "support_tickets" ("user_id");
CREATE INDEX IF NOT EXISTS "support_tickets_status_idx" ON "support_tickets" ("status");
CREATE INDEX IF NOT EXISTS "support_tickets_activity_idx" ON "support_tickets" ("last_activity_at");

CREATE TABLE IF NOT EXISTS "support_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ticket_id" uuid NOT NULL REFERENCES "support_tickets"("id") ON DELETE CASCADE,
  "author_role" varchar(16) NOT NULL,
  "author_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "body" text NOT NULL,
  "trace" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "support_messages_ticket_idx" ON "support_messages" ("ticket_id", "created_at");

COMMENT ON COLUMN "support_tickets"."status" IS
  'open | waiting_on_customer | escalated | resolved | closed — who the ball is with.';
COMMENT ON COLUMN "support_tickets"."handled_by" IS
  'assistant | admin — who finished it. NULL while it is still open.';
COMMENT ON COLUMN "support_messages"."trace" IS
  'Assistant reasoning for its own reply: evidence, options, action, verification. Never shown to the customer.';
COMMENT ON COLUMN "support_messages"."author_role" IS
  'customer | assistant | admin | system.';
