-- Queue notifications in the same PostgreSQL transaction as the ledger,
-- withdrawal status change or supported purchase delivery. No historical replay.
BEGIN;
CREATE TABLE IF NOT EXISTS wallet_email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_transaction_id uuid REFERENCES wallet_transactions(id) ON DELETE CASCADE,
  withdrawal_id uuid REFERENCES withdrawals(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  event_kind varchar(40) NOT NULL,
  recipient varchar(200) NOT NULL,
  payload text,
  status varchar(16) NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  lock_token uuid,
  first_attempt_at timestamptz,
  provider_message_id varchar(100),
  last_error varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT wallet_email_outbox_status_check CHECK (status IN ('pending', 'sending', 'sent', 'review')),
  CONSTRAINT wallet_email_outbox_event_check CHECK (
    (event_kind = 'wallet' AND wallet_transaction_id IS NOT NULL AND withdrawal_id IS NULL AND order_id IS NULL)
    OR (event_kind IN ('withdrawal_processing', 'withdrawal_completed', 'withdrawal_rejected') AND withdrawal_id IS NOT NULL AND wallet_transaction_id IS NULL AND order_id IS NULL)
    OR (event_kind = 'purchase_completed' AND order_id IS NOT NULL AND wallet_transaction_id IS NULL AND withdrawal_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS wallet_email_outbox_transaction_idx ON wallet_email_outbox(wallet_transaction_id);
CREATE UNIQUE INDEX IF NOT EXISTS wallet_email_outbox_withdrawal_event_idx ON wallet_email_outbox(withdrawal_id, event_kind);
CREATE UNIQUE INDEX IF NOT EXISTS wallet_email_outbox_order_event_idx ON wallet_email_outbox(order_id, event_kind);
CREATE INDEX IF NOT EXISTS wallet_email_outbox_due_idx ON wallet_email_outbox(status, available_at);

CREATE OR REPLACE FUNCTION enqueue_wallet_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO wallet_email_outbox (user_id, wallet_transaction_id, event_kind, recipient)
    SELECT NEW.user_id, NEW.id, 'wallet', email FROM users WHERE id = NEW.user_id
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS wallet_transaction_email ON wallet_transactions;
CREATE TRIGGER wallet_transaction_email AFTER INSERT ON wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION enqueue_wallet_email();

CREATE OR REPLACE FUNCTION enqueue_withdrawal_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('processing', 'completed', 'rejected') THEN
    INSERT INTO wallet_email_outbox (user_id, withdrawal_id, event_kind, recipient)
      SELECT NEW.user_id, NEW.id, 'withdrawal_' || NEW.status, email FROM users WHERE id = NEW.user_id
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS withdrawal_status_email ON withdrawals;
CREATE TRIGGER withdrawal_status_email AFTER UPDATE OF status ON withdrawals
  FOR EACH ROW EXECUTE FUNCTION enqueue_withdrawal_email();

-- The marketplace only marks an order delivered after its complete supplier
-- receipt is saved. Never send credentials or infer delivery for other providers.
CREATE OR REPLACE FUNCTION enqueue_purchase_completion_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'delivered' AND NEW.provider = 'accounts' THEN
    INSERT INTO wallet_email_outbox (user_id, order_id, event_kind, recipient)
      SELECT NEW.user_id, NEW.id, 'purchase_completed', email FROM users WHERE id = NEW.user_id
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS purchase_completion_email ON orders;
CREATE TRIGGER purchase_completion_email AFTER UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION enqueue_purchase_completion_email();
COMMIT;
