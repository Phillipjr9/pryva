-- The activation material for an eSIM purchase.
--
-- An eSIM order is not delivered by sending anything: the supplier returns the
-- profile once the order is provisioned, and the customer installs it from a QR
-- code or a manual `LPA:` string. Until now there was nowhere to keep that, so
-- eSIM could be catalogued but never handed over.
--
-- Three columns on `orders`, not a new table, because a profile is one-to-one
-- with the order that produced it and is read on the same page:
--
--   * `esim_iccid` is what re-reads the profile later. Losing the activation
--     code is recoverable only through the ICCID — the supplier documents a
--     profile as readable again by that id — so it is the durable half.
--   * `esim_activation_code` is the bearer credential (`LPA:1$…`). Anyone who
--     holds it can install the plan. It is stored here so the customer can come
--     back to it, and the order page is the only place it is rendered: never
--     logged, never emailed, never put in an error message.
--   * `esim_install_url` is the one-tap install link where the supplier offers
--     one. Same handling as the activation code.
--
-- `reference_code` already exists but is not reused for any of these: it is
-- rendered as a plain receipt string in the order list, and a credential must
-- not appear there.
--
-- Additive and idempotent.

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "esim_iccid" varchar(40);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "esim_activation_code" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "esim_install_url" text;
