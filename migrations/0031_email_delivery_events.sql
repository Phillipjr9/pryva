-- Did the email arrive? A receipt for every delivery Resend reports back.
--
-- The outbox knows when it handed a message to Resend, and that is all it knows.
-- "sent" therefore means "accepted by the provider", not "in the customer's
-- inbox": a bounced receipt, a spam-foldered verification link and an address
-- that never existed all look identical from here, and the first anyone hears of
-- it is a customer saying the code never came.
--
-- This mirrors `webhook_events`, which exists for exactly the same reason on the
-- payment side. Both answer one question an operator asks when something is
-- wrong: is the vendor talking to us at all, and what is it saying?
--
-- No address is stored. The event carries the outbox row's message id, so the
-- recipient is recoverable by joins from `wallet_email_outbox`; what is kept here
-- is the domain, which is enough to spot a whole mailbox provider refusing us
-- without turning this table into a copy of the customer list.
BEGIN;

CREATE TABLE IF NOT EXISTS email_delivery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Resend's own event id (the Svix message id). Used to collapse redeliveries:
  -- the provider retries, and a bounce counted three times reads as three
  -- complaints.
  provider_event_id varchar(100),
  -- The provider's event name, e.g. email.bounced. Bounded by the sender, not us.
  event varchar(60) NOT NULL,
  -- Resend's email id, which `wallet_email_outbox.provider_message_id` also holds.
  message_id varchar(100),
  -- Recipient domain only, never the mailbox.
  recipient_domain varchar(200),
  -- False for a body that failed verification. Such a row stores no event and no
  -- message id, because an unverified body is an attacker's text, not data.
  signature_valid boolean NOT NULL,
  outcome varchar(40) NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- One row per provider event, so a redelivery is a no-op rather than a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS email_delivery_events_provider_event_idx
  ON email_delivery_events(provider_event_id) WHERE provider_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_delivery_events_received_idx ON email_delivery_events(received_at);
CREATE INDEX IF NOT EXISTS email_delivery_events_message_idx ON email_delivery_events(message_id);

COMMIT;
