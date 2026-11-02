-- A boost now tells the customer it finished.
--
-- Until now `wallet-email-outbox.ts` had no `boost_complete` event, so a
-- delivered boost was only visible to whoever happened to open the order page.
-- Boosts are the one product delivered *slowly* — a panel can take days — so the
-- customer is by definition not watching when it lands. That is the same gap the
-- number-code email closed in 0029, one service over.
--
-- The queue row is written by a trigger rather than by application code because
-- the status change arrives from two places (`syncBoostOrderStatus` on a page
-- view and `sweepBoostDeliveries` in the nightly job) and will arrive from a
-- third if an operator ever marks one delivered by hand. A trigger cannot be
-- forgotten by a new caller.
BEGIN;

-- The constraint from 0005/0028/0029 lists every event kind. It is restated in
-- full here rather than amended, because a migration that assumes which of those
-- ran is a migration that fails on a database built in a different order.
ALTER TABLE wallet_email_outbox DROP CONSTRAINT IF EXISTS wallet_email_outbox_event_check;
ALTER TABLE wallet_email_outbox ADD CONSTRAINT wallet_email_outbox_event_check CHECK (
  (event_kind = 'wallet' AND wallet_transaction_id IS NOT NULL AND withdrawal_id IS NULL AND order_id IS NULL)
  OR (event_kind IN ('withdrawal_processing', 'withdrawal_completed', 'withdrawal_rejected') AND withdrawal_id IS NOT NULL AND wallet_transaction_id IS NULL AND order_id IS NULL)
  OR (event_kind IN ('purchase_completed', 'esim_delivery', 'number_code', 'boost_complete') AND order_id IS NOT NULL AND wallet_transaction_id IS NULL AND withdrawal_id IS NULL)
);

-- One email per boost, ever. `wallet_email_outbox_order_event_idx` (partial from
-- 0029, full before it) already enforces (order_id, event_kind), so a boost that
-- goes delivered → review → delivered again cannot mail twice: the insert below
-- conflicts and does nothing.
CREATE OR REPLACE FUNCTION enqueue_boost_complete_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.provider = 'smm'
     AND NEW.status = 'delivered'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'delivered') THEN
    INSERT INTO wallet_email_outbox (user_id, order_id, event_kind, recipient)
      SELECT NEW.user_id, NEW.id, 'boost_complete', email FROM users WHERE id = NEW.user_id
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS boost_complete_email ON orders;
CREATE TRIGGER boost_complete_email AFTER INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION enqueue_boost_complete_email();

COMMIT;
