-- New, event-driven customer emails: real human support replies, passkey
-- additions/removals, and a purchase receipt after a paid order is accepted.
-- No historical messages are replayed. The old application can remain live while
-- this migration runs: its worker cannot claim these unfamiliar kinds because
-- available_at (and, while sending, locked_until) stay far in the future.
BEGIN;

-- Snapshots, not foreign keys: removing a passkey must not erase its alert, and
-- support email must never contain the ticket body or the assistant's trace.
ALTER TABLE wallet_email_outbox ADD COLUMN IF NOT EXISTS support_ticket_id uuid;
ALTER TABLE wallet_email_outbox ADD COLUMN IF NOT EXISTS support_message_id uuid;
ALTER TABLE wallet_email_outbox ADD COLUMN IF NOT EXISTS passkey_row_id uuid;

ALTER TABLE wallet_email_outbox DROP CONSTRAINT IF EXISTS wallet_email_outbox_event_check;
ALTER TABLE wallet_email_outbox ADD CONSTRAINT wallet_email_outbox_event_check CHECK (
  (event_kind = 'wallet' AND wallet_transaction_id IS NOT NULL AND withdrawal_id IS NULL AND order_id IS NULL AND bank_account_id IS NULL AND support_ticket_id IS NULL AND support_message_id IS NULL AND passkey_row_id IS NULL)
  OR (event_kind IN ('withdrawal_processing', 'withdrawal_completed', 'withdrawal_rejected', 'withdrawal_failed') AND withdrawal_id IS NOT NULL AND wallet_transaction_id IS NULL AND order_id IS NULL AND bank_account_id IS NULL AND support_ticket_id IS NULL AND support_message_id IS NULL AND passkey_row_id IS NULL)
  OR (event_kind IN ('purchase_completed', 'esim_delivery', 'number_code') AND order_id IS NOT NULL AND wallet_transaction_id IS NULL AND withdrawal_id IS NULL AND bank_account_id IS NULL AND support_ticket_id IS NULL AND support_message_id IS NULL AND passkey_row_id IS NULL)
  OR (event_kind IN ('first_purchase', 'purchase_recorded') AND wallet_transaction_id IS NOT NULL AND withdrawal_id IS NULL AND order_id IS NULL AND bank_account_id IS NULL AND support_ticket_id IS NULL AND support_message_id IS NULL AND passkey_row_id IS NULL)
  OR (event_kind = 'bank_linked' AND bank_account_id IS NOT NULL AND wallet_transaction_id IS NULL AND withdrawal_id IS NULL AND order_id IS NULL AND support_ticket_id IS NULL AND support_message_id IS NULL AND passkey_row_id IS NULL)
  OR (event_kind = 'password_changed' AND wallet_transaction_id IS NULL AND withdrawal_id IS NULL AND order_id IS NULL AND bank_account_id IS NULL AND support_ticket_id IS NULL AND support_message_id IS NULL AND passkey_row_id IS NULL)
  OR (event_kind = 'support_reply' AND support_ticket_id IS NOT NULL AND support_message_id IS NOT NULL AND wallet_transaction_id IS NULL AND withdrawal_id IS NULL AND order_id IS NULL AND bank_account_id IS NULL AND passkey_row_id IS NULL)
  OR (event_kind IN ('passkey_added', 'passkey_removed') AND passkey_row_id IS NOT NULL AND wallet_transaction_id IS NULL AND withdrawal_id IS NULL AND order_id IS NULL AND bank_account_id IS NULL AND support_ticket_id IS NULL AND support_message_id IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS wallet_email_outbox_support_reply_idx
  ON wallet_email_outbox(support_message_id) WHERE event_kind = 'support_reply';
CREATE UNIQUE INDEX IF NOT EXISTS wallet_email_outbox_passkey_event_idx
  ON wallet_email_outbox(passkey_row_id, event_kind) WHERE event_kind IN ('passkey_added', 'passkey_removed');
CREATE UNIQUE INDEX IF NOT EXISTS wallet_email_outbox_purchase_recorded_idx
  ON wallet_email_outbox(wallet_transaction_id) WHERE event_kind = 'purchase_recorded';
CREATE INDEX IF NOT EXISTS wallet_email_outbox_user_idx ON wallet_email_outbox(user_id);

-- All queue producers, including older triggers, must serialize with account
-- closure. A concurrent insert that waited for closure rechecks deleted_at and
-- drops the notification instead of keeping or mailing the old address.
CREATE OR REPLACE FUNCTION wallet_email_owner_is_active() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE active_user uuid;
BEGIN
  SELECT id INTO active_user FROM users WHERE id = NEW.user_id AND deleted_at IS NULL FOR SHARE;
  IF active_user IS NULL THEN RETURN NULL; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS wallet_email_active_owner ON wallet_email_outbox;
CREATE TRIGGER wallet_email_active_owner BEFORE INSERT ON wallet_email_outbox
  FOR EACH ROW EXECUTE FUNCTION wallet_email_owner_is_active();

-- Old application instances may still be finishing registration or an address
-- change during rollout. Reject (rather than silently skip) inserts for a closed
-- owner, so the old caller cannot report a registration that was not stored.
-- The shared owner lock serializes with the closure transaction's exclusive lock.
CREATE OR REPLACE FUNCTION security_record_owner_must_be_active() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM users WHERE id = NEW.user_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Security record owner is not active';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS webauthn_credential_active_owner ON webauthn_credentials;
CREATE TRIGGER webauthn_credential_active_owner BEFORE INSERT OR UPDATE OF user_id ON webauthn_credentials
  FOR EACH ROW EXECUTE FUNCTION security_record_owner_must_be_active();
DROP TRIGGER IF EXISTS email_change_request_active_owner ON email_change_requests;
CREATE TRIGGER email_change_request_active_owner BEFORE INSERT OR UPDATE OF user_id ON email_change_requests
  FOR EACH ROW EXECUTE FUNCTION security_record_owner_must_be_active();

-- An earlier version containing historical deletions was already applied in
-- production. Editing this file does not rerun it or restore any deleted rows.
-- This version leaves historical closed-account rows unchanged. The new
-- worker skips their queued mail; reviewing or removing old snapshots and
-- credentials requires separate owner authorization. New closures still remove
-- their own sensitive records in the account-closure transaction.

-- The account row is locked while looking up its address. Closure takes an
-- exclusive lock on the same row and marks it deleted before removing passkeys;
-- this prevents false passkey alerts for closure and serializes competing writes.
CREATE OR REPLACE FUNCTION enqueue_passkey_activity_email() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid; credential_row uuid; kind text; destination text; owner_name text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    owner_id := NEW.user_id; credential_row := NEW.id; kind := 'passkey_added';
  ELSE
    owner_id := OLD.user_id; credential_row := OLD.id; kind := 'passkey_removed';
  END IF;
  SELECT email, name INTO destination, owner_name FROM users
    WHERE id = owner_id AND deleted_at IS NULL FOR SHARE;
  IF FOUND THEN
    INSERT INTO wallet_email_outbox (user_id, passkey_row_id, event_kind, recipient, recipient_name, available_at, notification_due_at)
      VALUES (owner_id, credential_row, kind, destination, owner_name, now() + interval '10 years', now())
      ON CONFLICT DO NOTHING;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS passkey_activity_email ON webauthn_credentials;
CREATE TRIGGER passkey_activity_email AFTER INSERT OR DELETE ON webauthn_credentials
  FOR EACH ROW EXECUTE FUNCTION enqueue_passkey_activity_email();

-- Only a human reply is news the customer might miss. Assistant replies appear
-- immediately in the chat, and state-only changes do not send an email. Subject,
-- message text and AI trace stay in the authenticated thread, not in the email.
CREATE OR REPLACE FUNCTION enqueue_support_reply_email() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid; destination text; owner_name text;
BEGIN
  IF NEW.author_role <> 'admin' THEN RETURN NEW; END IF;
  SELECT u.id, u.email, u.name INTO owner_id, destination, owner_name
    FROM support_tickets t JOIN users u ON u.id = t.user_id
    WHERE t.id = NEW.ticket_id AND u.deleted_at IS NULL FOR SHARE OF u;
  IF FOUND THEN
    INSERT INTO wallet_email_outbox (user_id, support_ticket_id, support_message_id, event_kind, recipient, recipient_name, available_at, notification_due_at)
      VALUES (owner_id, NEW.ticket_id, NEW.id, 'support_reply', destination, owner_name, now() + interval '10 years', now())
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS support_reply_email ON support_messages;
CREATE TRIGGER support_reply_email AFTER INSERT ON support_messages
  FOR EACH ROW EXECUTE FUNCTION enqueue_support_reply_email();

-- The first purchase already gets its own milestone email. Avoid a second order
-- receipt for the same debit. A marketplace delivery notice already includes
-- the amount and reference, so avoid duplicating that notice too. The normal
-- wallet-debit email is a distinct ledger record, not an order status promise.
CREATE OR REPLACE FUNCTION enqueue_purchase_recorded_email(transaction_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO wallet_email_outbox (user_id, wallet_transaction_id, event_kind, recipient, available_at, notification_due_at)
    SELECT t.user_id, t.id, 'purchase_recorded', u.email, now() + interval '10 years', now()
      FROM wallet_transactions t JOIN users u ON u.id = t.user_id
      WHERE t.id = transaction_id AND u.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM wallet_email_outbox f WHERE f.event_kind = 'first_purchase' AND f.wallet_transaction_id = t.id)
        AND NOT EXISTS (SELECT 1 FROM wallet_email_outbox p WHERE p.event_kind = 'purchase_completed' AND p.order_id = t.order_id)
    ON CONFLICT DO NOTHING;
END;
$$;

-- Trigger names sort after the first-purchase and marketplace-delivery triggers,
-- so the suppression checks above see those rows in the same transaction.
CREATE OR REPLACE FUNCTION purchase_recorded_from_debit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type <> 'debit' THEN RETURN NEW; END IF;
  IF NEW.order_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM orders o WHERE o.id = NEW.order_id AND o.user_id = NEW.user_id
      AND (o.status IN ('active', 'delivered', 'completed') OR (o.status = 'processing' AND o.provider = 'manual'))
      AND o.refunded_at IS NULL AND o.provider <> 'preview'
  ) THEN
    PERFORM enqueue_purchase_recorded_email(NEW.id);
  ELSIF NEW.order_id IS NULL AND (
    (NEW.reference ~ '^BLK-[A-Z0-9]{21}$' AND NEW.description LIKE 'Bulk purchase:%')
    OR (NEW.reference LIKE 'GIFT-PRYVA-%' AND NEW.description LIKE 'Gift card purchase:%')
  ) THEN
    PERFORM enqueue_purchase_recorded_email(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS purchase_recorded_debit_email ON wallet_transactions;
CREATE TRIGGER purchase_recorded_debit_email AFTER INSERT ON wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION purchase_recorded_from_debit();

CREATE OR REPLACE FUNCTION purchase_recorded_from_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE transaction_id uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND (NEW.status IN ('active', 'delivered', 'completed') OR (NEW.status = 'processing' AND NEW.provider = 'manual'))
     AND NEW.refunded_at IS NULL AND NEW.provider <> 'preview' THEN
    SELECT id INTO transaction_id FROM wallet_transactions
      WHERE user_id = NEW.user_id AND order_id = NEW.id AND type = 'debit'
      ORDER BY created_at, id LIMIT 1;
    IF transaction_id IS NOT NULL THEN PERFORM enqueue_purchase_recorded_email(transaction_id); END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS purchase_recorded_order_email ON orders;
CREATE TRIGGER purchase_recorded_order_email AFTER UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION purchase_recorded_from_order();

COMMIT;
