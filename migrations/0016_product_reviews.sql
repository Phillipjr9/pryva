-- Verified-purchase reviews.
--
-- The rule this table exists to enforce: a review may only be written by the
-- account that bought the order, and the order must have actually been delivered
-- or completed. There is no seeded, imported or invented content here — the
-- public page shows nothing until a real customer writes one and an operator
-- publishes it.
--
-- Three choices worth stating:
--
--   * `order_id` is UNIQUE. One order, one review: no editing a score upward
--     after a refund, and no farming five stars from one purchase.
--   * `service` and `product_name` are copied from the order. The catalogue
--     changes and listings get delisted; a review must keep saying what was
--     bought, and it must not be joinable into a supplier name later.
--   * `status` starts at 'pending'. Nothing reaches a public page without a
--     human decision, recorded with who made it and when.
--
-- Additive and idempotent, so applying it twice is a no-op.
CREATE TABLE IF NOT EXISTS "product_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE cascade,
  -- Snapshot of what was bought, not a live join into a mutable catalogue.
  "service" varchar(40) NOT NULL,
  "product_name" varchar(160) NOT NULL,
  "rating" integer NOT NULL,
  "headline" varchar(80),
  "body" text NOT NULL,
  -- 'pending' | 'published' | 'rejected'
  "status" varchar(16) DEFAULT 'pending' NOT NULL,
  "moderator_note" text,
  "moderated_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "moderated_at" timestamp with time zone,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "product_reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
  CONSTRAINT "product_reviews_body_check" CHECK (char_length("body") BETWEEN 20 AND 1200)
);

-- One review per order.
CREATE UNIQUE INDEX IF NOT EXISTS "product_reviews_order_id_key"
  ON "product_reviews" ("order_id");
CREATE INDEX IF NOT EXISTS "product_reviews_status_created_idx"
  ON "product_reviews" ("status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "product_reviews_user_idx"
  ON "product_reviews" ("user_id");
