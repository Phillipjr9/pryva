-- Disposable inboxes: one free at a time, and room for the paid tier beside it.
--
-- The temporary inbox is the one free thing Pryva offers. Everything else is
-- priced, and the free tier exists to be outgrown: one inbox a day, read while
-- it is alive, nothing kept afterwards. The paid tier sells volume and history
-- instead of time, because the supplier sets an inbox's own lifetime and sells
-- no duration we could mark up -- a "24-hour" and a "30-day" inbox are the same
-- purchase on their side, which is why four such tiers were removed rather than
-- shipped undeliverable.
--
-- Two limits are enforced here rather than in application code, because both are
-- about two requests arriving at once and an application check would let both
-- through:
--
--   * one *active free* inbox per user -- the partial index is scoped to
--     tier = 'free' on purpose. A paid bundle is several concurrent inboxes, so a
--     blanket "one active inbox" index would have made the paid tier impossible
--     to fulfil without a second migration.
--   * one free inbox per user per day -- `daily_key` is "<user_id>:<yyyy-mm-dd>",
--     set for free inboxes only and left NULL for paid ones, so the unique index
--     cannot collide across tiers or across days.
--
-- Buying an inbox spends real money with the supplier the moment it is created,
-- so the database refusing the second concurrent request is what makes the daily
-- cap a cost control rather than a suggestion.
CREATE TABLE IF NOT EXISTS "disposable_inboxes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  -- Which source supplied it. A column rather than an assumption, so a second
  -- provider needs no migration and so a stranded inbox can still be cancelled
  -- through the client that created it.
  "provider" varchar(32) NOT NULL,
  -- The provider's own handle for the inbox. Polling and cancelling both need
  -- it, and it is the only way to reconcile an inbox whose address we lost.
  "provider_inbox_id" varchar(191) NOT NULL,
  "address" varchar(320) NOT NULL,
  "domain" varchar(255),
  -- 'free' | 'paid'. Decides which limits apply and whether messages are kept.
  "tier" varchar(16) NOT NULL DEFAULT 'free',
  -- Paid inboxes are ordinary purchases, so they carry the order that paid for
  -- them. Free ones move no money and stay NULL: recording them as orders would
  -- put zero-revenue rows into margin analytics for no reason.
  "order_id" uuid REFERENCES "orders"("id") ON DELETE set null,
  -- 'active' | 'discarded' | 'expired' | 'failed'
  "status" varchar(24) NOT NULL DEFAULT 'active',
  "daily_key" varchar(80),
  -- The provider's own expiry, when it reports one. We never extend it; the free
  -- tier may end an inbox sooner, but nothing can make one live longer than the
  -- supplier allows.
  "expires_at" timestamp with time zone,
  "discarded_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "disposable_inboxes_one_active_free_per_user"
  ON "disposable_inboxes" ("user_id") WHERE "status" = 'active' AND "tier" = 'free';
CREATE UNIQUE INDEX IF NOT EXISTS "disposable_inboxes_free_daily_key"
  ON "disposable_inboxes" ("daily_key") WHERE "daily_key" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "disposable_inboxes_user_idx"
  ON "disposable_inboxes" ("user_id");

-- Messages that arrived in an inbox.
--
-- Kept for paid inboxes, which is what the customer is buying: a free inbox is
-- read while it is alive and then gone, a paid one can be come back to. Polling
-- re-reads the whole mailbox every time and the provider gives messages no
-- identity of their own, so `fingerprint` is a hash of the parts that do
-- distinguish one message from another and the unique index makes a repeated
-- poll insert nothing new. Without it, every refresh would duplicate the
-- mailbox.
CREATE TABLE IF NOT EXISTS "inbox_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "inbox_id" uuid NOT NULL REFERENCES "disposable_inboxes"("id") ON DELETE cascade,
  -- Denormalised from the inbox so a customer's own messages can be listed and
  -- deleted with them without a join, and so ownership is checked per row.
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "fingerprint" varchar(64) NOT NULL,
  "subject" text,
  "from_address" text,
  "body" text,
  -- The parsed verification code, when the provider recognised one.
  "code" varchar(64),
  "received_at" timestamp with time zone,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "inbox_messages_once_per_inbox"
  ON "inbox_messages" ("inbox_id", "fingerprint");
CREATE INDEX IF NOT EXISTS "inbox_messages_inbox_idx"
  ON "inbox_messages" ("inbox_id");
CREATE INDEX IF NOT EXISTS "inbox_messages_user_idx"
  ON "inbox_messages" ("user_id");
