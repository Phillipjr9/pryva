-- Keep the exact buyer-visible redemption/region restrictions as durable evidence.
ALTER TABLE foxreload_quotes ADD COLUMN IF NOT EXISTS customer_terms varchar(500);
