-- Record what each order's unit actually cost us.
--
-- The cost sheet holds planned wholesale prices. Real margin can only be
-- measured from what the provider charged (or quoted, where it reports no
-- charge), so that figure is persisted per order. Server-side only: this is
-- wholesale cost and must never reach a customer-facing surface.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "provider_cost_ngn" integer;
