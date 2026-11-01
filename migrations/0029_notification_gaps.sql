-- Two gaps closed at once, both about a customer not having to sit on a page:
--
--  1. a verification code is only ever read by polling the order page, so a
--     customer who closed the tab never learns one arrived;
--  2. an account's email address cannot be changed at all, which is the one
--     identity field a person actually outgrows.
BEGIN;

-- ---------------------------------------------------------------- number code
-- The code landing on the order is the delivery. Single verification only:
-- a rental receives many messages, and one email per message is spam, not news.
ALTER TABLE wallet_email_outbox DROP CONSTRAINT IF EXISTS wallet_email_outbox_event_check;
ALTER TABLE wallet_email_outbox ADD CONSTRAINT wallet_email_outbox_event_check CHECK (
  (event_kind = 'wallet' AND wallet_transaction_id IS NOT NULL AND withdrawal_id IS NULL AND order_id IS NULL)
  OR (event_kind IN ('withdrawal_processing', 'withdrawal_completed', 'withdrawal_rejected') AND withdrawal_id IS NOT NULL AND wallet_transaction_id IS NULL AND order_id IS NULL)
  OR (event_kind IN ('purchase_completed', 'esim_delivery', 'number_code') AND order_id IS NOT NULL AND wallet_transaction_id IS NULL AND withdrawal_id IS NULL)
);

-- A number can legitimately receive a second code (a resent one), and each is
-- news to someone watching their inbox. Purchase and eSIM emails stay
-- once-per-order; only this kind is allowed to repeat.
DROP INDEX IF EXISTS wallet_email_outbox_order_event_idx;
CREATE UNIQUE INDEX wallet_email_outbox_order_event_idx
  ON wallet_email_outbox(order_id, event_kind)
  WHERE event_kind <> 'number_code';

CREATE OR REPLACE FUNCTION enqueue_number_code_email() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.service = 'numbers'
     AND NEW.otp_code IS NOT NULL
     AND length(NEW.otp_code) > 0
     AND NEW.duration NOT LIKE 'Rent%'
     AND NEW.provider <> 'preview'
     AND (TG_OP = 'INSERT' OR OLD.otp_code IS DISTINCT FROM NEW.otp_code) THEN
    INSERT INTO wallet_email_outbox (user_id, order_id, event_kind, recipient)
      SELECT NEW.user_id, NEW.id, 'number_code', email FROM users WHERE id = NEW.user_id
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS number_code_email ON orders;
CREATE TRIGGER number_code_email AFTER INSERT OR UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION enqueue_number_code_email();

-- ------------------------------------------------------- email change request
-- Changing an address has to prove control of the *new* one before anything
-- moves: otherwise a stolen session can redirect every future password reset.
-- Only a hash of the token is stored, exactly like the verification flow.
CREATE TABLE IF NOT EXISTS email_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  new_email varchar(320) NOT NULL,
  token_hash varchar(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_change_requests_token_unique UNIQUE (token_hash)
);
CREATE INDEX IF NOT EXISTS email_change_requests_user_idx ON email_change_requests(user_id);
-- One live request per account: asking again replaces the previous link.
CREATE UNIQUE INDEX IF NOT EXISTS email_change_requests_live_idx
  ON email_change_requests(user_id) WHERE consumed_at IS NULL;

COMMIT;
