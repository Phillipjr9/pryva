-- What the payment provider actually sent us, kept where an operator can read it.
--
-- The webhook is the only thing that settles a payout in seconds, and until now
-- the only way to answer "is it arriving?" was to wait for a customer to complain
-- that their withdrawal said "Sent to bank" for a day. That is not a monitoring
-- story: a URL that was never saved, an endpoint that answers 500, and a body whose
-- signature does not verify all look identical from the outside — nothing happens.
--
-- So every delivery is recorded, including the ones this app refuses:
--
--   * recognised events record what was applied (`settled`, `refunded`, `ignored`);
--   * a failed signature records `rejected_signature` and nothing else, because the
--     body cannot be trusted and its fields are not stored;
--   * the table holds no payload, no bank details and no customer identity — an
--     event name, a reference, a verdict and a timestamp are enough to say whether
--     the pipe works and what it did.
--
-- Rows are pruned after 30 days by the nightly job, so a flood of forged requests
-- cannot grow the table without bound. There is deliberately no foreign key: a log
-- of deliveries must survive whatever happens to the rows it describes.
--
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS "webhook_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event" varchar(60) NOT NULL,
  "reference" varchar(60),
  "signature_valid" boolean NOT NULL,
  "outcome" varchar(40) NOT NULL,
  "received_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "webhook_events_received_idx" ON "webhook_events" ("received_at");
CREATE INDEX IF NOT EXISTS "webhook_events_event_idx" ON "webhook_events" ("event");
