-- Durable bank-link and password-change alerts, one first-purchase milestone,
-- and truthful notifications for failed withdrawals. No historical mail replay.
BEGIN;

ALTER TABLE wallet_email_outbox ADD COLUMN IF NOT EXISTS bank_account_id uuid;
ALTER TABLE wallet_email_outbox ADD COLUMN IF NOT EXISTS bank_name_snapshot varchar(100);
ALTER TABLE wallet_email_outbox ADD COLUMN IF NOT EXISTS bank_last_four varchar(4);
ALTER TABLE wallet_email_outbox ADD COLUMN IF NOT EXISTS recipient_name varchar(120);
-- New event kinds must remain invisible to an old worker during deployment:
-- the migration runs during the build, before the new application is promoted.
-- Its worker uses this due time; old workers only see available_at far in the future.
ALTER TABLE wallet_email_outbox ADD COLUMN IF NOT EXISTS notification_due_at timestamptz;
-- The old worker also reclaims expired sending leases. A second lease lets new
-- workers retry while the old lease remains safely in the future.
ALTER TABLE wallet_email_outbox ADD COLUMN IF NOT EXISTS notification_locked_until timestamptz;
CREATE INDEX IF NOT EXISTS wallet_email_outbox_notification_due_idx
  ON wallet_email_outbox(status, notification_due_at) WHERE notification_due_at IS NOT NULL;

ALTER TABLE wallet_email_outbox DROP CONSTRAINT IF EXISTS wallet_email_outbox_event_check;
ALTER TABLE wallet_email_outbox ADD CONSTRAINT wallet_email_outbox_event_check CHECK (
  (event_kind = 'wallet' AND wallet_transaction_id IS NOT NULL AND withdrawal_id IS NULL AND order_id IS NULL AND bank_account_id IS NULL)
  OR (event_kind IN ('withdrawal_processing', 'withdrawal_completed', 'withdrawal_rejected', 'withdrawal_failed') AND withdrawal_id IS NOT NULL AND wallet_transaction_id IS NULL AND order_id IS NULL AND bank_account_id IS NULL)
  OR (event_kind IN ('purchase_completed', 'esim_delivery', 'number_code') AND order_id IS NOT NULL AND wallet_transaction_id IS NULL AND withdrawal_id IS NULL AND bank_account_id IS NULL)
  OR (event_kind = 'first_purchase' AND wallet_transaction_id IS NOT NULL AND withdrawal_id IS NULL AND order_id IS NULL AND bank_account_id IS NULL)
  OR (event_kind = 'bank_linked' AND bank_account_id IS NOT NULL AND wallet_transaction_id IS NULL AND withdrawal_id IS NULL AND order_id IS NULL)
  OR (event_kind = 'password_changed' AND wallet_transaction_id IS NULL AND withdrawal_id IS NULL AND order_id IS NULL AND bank_account_id IS NULL)
);

-- A purchase can have both its ordinary wallet receipt and its milestone email.
DROP INDEX IF EXISTS wallet_email_outbox_transaction_idx;
CREATE UNIQUE INDEX wallet_email_outbox_transaction_idx ON wallet_email_outbox(wallet_transaction_id) WHERE event_kind = 'wallet';
CREATE UNIQUE INDEX IF NOT EXISTS wallet_email_outbox_bank_link_idx ON wallet_email_outbox(bank_account_id) WHERE event_kind = 'bank_linked';

-- Keep the once-per-account claim independently of individual email retention.
CREATE TABLE IF NOT EXISTS first_purchase_email_claims (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  source varchar(16) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION enqueue_first_purchase_email(transaction_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE claimed_user uuid;
BEGIN
  INSERT INTO first_purchase_email_claims (user_id, source)
    SELECT t.user_id, 'new' FROM wallet_transactions t JOIN users u ON u.id = t.user_id
    WHERE t.id = transaction_id AND u.deleted_at IS NULL
    ON CONFLICT DO NOTHING RETURNING user_id INTO claimed_user;
  IF claimed_user IS NOT NULL THEN
    INSERT INTO wallet_email_outbox (user_id, wallet_transaction_id, event_kind, recipient, available_at, notification_due_at)
      SELECT t.user_id, t.id, 'first_purchase', u.email, now() + interval '10 years', now()
      FROM wallet_transactions t JOIN users u ON u.id = t.user_id WHERE t.id = transaction_id;
  END IF;
END;
$$;

-- Only paid, accepted orders qualify: active/delivered orders, or a manual
-- purchase accepted for preparation. Bulk and wallet gift-card purchases have
-- one debit but no order_id.
CREATE OR REPLACE FUNCTION first_purchase_from_debit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type <> 'debit' THEN RETURN NEW; END IF;
  IF NEW.order_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM orders o WHERE o.id = NEW.order_id AND o.user_id = NEW.user_id
      AND (o.status IN ('active', 'delivered', 'completed') OR (o.status = 'processing' AND o.provider = 'manual'))
      AND o.refunded_at IS NULL AND o.provider <> 'preview'
  ) THEN
    PERFORM enqueue_first_purchase_email(NEW.id);
  ELSIF NEW.order_id IS NULL AND (
    (NEW.reference ~ '^BLK-[A-Z0-9]{21}$' AND NEW.description LIKE 'Bulk purchase:%')
    OR (NEW.reference LIKE 'GIFT-PRYVA-%' AND NEW.description LIKE 'Gift card purchase:%')
  ) THEN
    PERFORM enqueue_first_purchase_email(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS first_purchase_debit_email ON wallet_transactions;
CREATE TRIGGER first_purchase_debit_email AFTER INSERT ON wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION first_purchase_from_debit();

-- Other purchases debit first and only later move to active/delivered (e.g. a
-- boost or gift card). Failed or uncharged orders must never be celebrated.
CREATE OR REPLACE FUNCTION first_purchase_from_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE transaction_id uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND (NEW.status IN ('active', 'delivered', 'completed') OR (NEW.status = 'processing' AND NEW.provider = 'manual'))
     AND NEW.refunded_at IS NULL AND NEW.provider <> 'preview' THEN
    SELECT id INTO transaction_id FROM wallet_transactions
      WHERE user_id = NEW.user_id AND order_id = NEW.id AND type = 'debit'
      ORDER BY created_at, id LIMIT 1;
    IF transaction_id IS NOT NULL THEN PERFORM enqueue_first_purchase_email(transaction_id); END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS first_purchase_order_email ON orders;
CREATE TRIGGER first_purchase_order_email AFTER UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION first_purchase_from_order();

-- The triggers now hold write locks while historical buyers are marked. Existing
-- customers must not be told that their next order is their first one.
INSERT INTO first_purchase_email_claims (user_id, source)
  SELECT DISTINCT user_id, 'historical' FROM wallet_transactions
  WHERE type = 'debit' AND (order_id IS NOT NULL OR description LIKE 'Bulk purchase:%' OR description LIKE 'Gift card purchase:%')
  ON CONFLICT DO NOTHING;

-- Do not attach this event to the mutable bank row: removing a suspicious bank
-- account immediately must not erase the security alert before it is delivered.
CREATE OR REPLACE FUNCTION enqueue_bank_link_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO wallet_email_outbox (user_id, bank_account_id, bank_name_snapshot, bank_last_four, recipient_name, event_kind, recipient, available_at, notification_due_at)
    SELECT NEW.user_id, NEW.id, NEW.bank_name,
      CASE WHEN NEW.account_number ~ '^[0-9]{4,20}$' THEN right(NEW.account_number, 4) ELSE NULL END,
      u.name, 'bank_linked', u.email, now() + interval '10 years', now()
    FROM users u WHERE u.id = NEW.user_id AND u.deleted_at IS NULL
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bank_link_email ON bank_accounts;
CREATE TRIGGER bank_link_email AFTER INSERT ON bank_accounts
  FOR EACH ROW EXECUTE FUNCTION enqueue_bank_link_email();

-- Password-change notices are queued explicitly by the new password and reset
-- transactions. The previous application sent its settings notice directly;
-- a trigger enabled before the release would enqueue a duplicate during rollout.

CREATE OR REPLACE FUNCTION enqueue_withdrawal_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('processing', 'completed', 'rejected', 'failed') THEN
    INSERT INTO wallet_email_outbox (user_id, withdrawal_id, event_kind, recipient, available_at, notification_due_at)
      SELECT NEW.user_id, NEW.id, 'withdrawal_' || NEW.status, email,
        CASE WHEN NEW.status = 'failed' THEN now() + interval '10 years' ELSE now() END,
        CASE WHEN NEW.status = 'failed' THEN now() ELSE NULL END
      FROM users WHERE id = NEW.user_id ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
