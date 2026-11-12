CREATE TABLE IF NOT EXISTS "proxy_slots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "provider_slot_id" varchar(100) NOT NULL UNIQUE,
  "country" varchar(2) NOT NULL,
  "state" varchar(100),
  "proxy_type" integer NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'purchased',
  "expires_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "proxy_slots_order_idx" ON "proxy_slots" ("order_id");
