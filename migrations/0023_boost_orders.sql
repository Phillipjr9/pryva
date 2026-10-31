-- Boosting orders: the target profile/post and the quantity requested.
--
-- A submission order is a unit of work, not a unit of stock: the customer hands
-- us a link and a number, and we buy that many follows/likes/views from the
-- boosting supplier. Neither value fits any existing column — `referenceCode` is
-- rendered to the customer as their code, and `accounts` is a JSON array of
-- delivered credentials — so both are stored explicitly rather than smuggled
-- into a field with a different meaning.
--
-- `target_link` is customer-supplied and is shown back on the order: it is what
-- was ordered, and it is the only way to reconcile a delivery dispute later.
-- `quantity` is null for every non-boost order, which is why both columns are
-- nullable and un-defaulted.
--
-- Additive and idempotent.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS target_link varchar(500);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS quantity integer;
