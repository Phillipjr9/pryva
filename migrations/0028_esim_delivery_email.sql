-- Hand the eSIM over in the customer's inbox as well as on the order page.
--
-- The QR and the activation string are the actual product: a customer who closes
-- the tab (or loses the session) has no way back to them, and support has to
-- recover a profile by hand. Queueing the delivery email in the same transaction
-- as the profile write means the two can never disagree about whether the eSIM
-- was handed over.
BEGIN;

-- An eSIM delivery is an order event with no ledger row attached, exactly like a
-- marketplace purchase completion.
ALTER TABLE wallet_email_outbox DROP CONSTRAINT IF EXISTS wallet_email_outbox_event_check;
ALTER TABLE wallet_email_outbox ADD CONSTRAINT wallet_email_outbox_event_check CHECK (
  (event_kind = 'wallet' AND wallet_transaction_id IS NOT NULL AND withdrawal_id IS NULL AND order_id IS NULL)
  OR (event_kind IN ('withdrawal_processing', 'withdrawal_completed', 'withdrawal_rejected') AND withdrawal_id IS NOT NULL AND wallet_transaction_id IS NULL AND order_id IS NULL)
  OR (event_kind IN ('purchase_completed', 'esim_delivery') AND order_id IS NOT NULL AND wallet_transaction_id IS NULL AND withdrawal_id IS NULL)
);

-- The handover is the activation material appearing, not a status word: the
-- purchase path inserts an eSIM order already active, while the completion sweep
-- updates one that was still provisioning. Both are deliveries, so the trigger
-- watches the column rather than the status, and the unique
-- (order_id, event_kind) index keeps it to one email per order.
CREATE OR REPLACE FUNCTION enqueue_esim_delivery_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.service = 'esim' AND NEW.esim_activation_code IS NOT NULL AND length(NEW.esim_activation_code) > 0 THEN
    INSERT INTO wallet_email_outbox (user_id, order_id, event_kind, recipient)
      SELECT NEW.user_id, NEW.id, 'esim_delivery', email FROM users WHERE id = NEW.user_id
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS esim_delivery_email ON orders;
CREATE TRIGGER esim_delivery_email AFTER INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION enqueue_esim_delivery_email();

COMMIT;
