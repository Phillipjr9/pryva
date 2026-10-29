-- Drop the "simulated" default from orders.provider.
--
-- The column records which provider fulfilled an order, which is also the
-- provider that must be asked to release the unit on a refund. A default meant
-- any insert path that forgot to name one silently recorded a supplier that does
-- not exist, and upstream cancellation would then match nothing and fail quietly.
-- Every production insert already names a provider explicitly, so this only
-- affects paths that were relying on the default to hide an omission.
ALTER TABLE "orders" ALTER COLUMN "provider" DROP DEFAULT;
