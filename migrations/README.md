# Migrations

## Fresh database

Apply the baseline and all numbered top-level migrations, in order, with errors
stopping the deployment:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0000_base_schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0001_google_subject.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0002_shared_rate_limits.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0003_withdrawal_idempotency.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0004_paystack_transfer_reference.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0005_wallet_email_outbox.sql
```

The baseline creates the 12 original application tables and their indexes/foreign keys.
The incremental migrations add the unique nullable Google subject used by
sign-in, the shared rate-limit table, withdrawal request idempotency keys, a durable Paystack transfer reference, and the transactional wallet email outbox.
Back up existing databases before applying migrations and verify the schema before routing traffic.

## Existing databases

An installation already on the baseline must apply `0001_google_subject.sql`,
`0002_shared_rate_limits.sql`, `0003_withdrawal_idempotency.sql`, `0004_paystack_transfer_reference.sql` and `0005_wallet_email_outbox.sql` before deploying this version. Missing the
rate-limit migration makes protected endpoints fail closed with HTTP 503; missing either withdrawal migration prevents withdrawal processing and may break queries selecting withdrawal rows. Migration 0004 leaves existing references NULL: reconcile pre-existing pending and `processing` withdrawals with Paystack before approval, retry, refund or state changes, especially any rows manually reset to pending. Never infer that an unknown reference means a transfer did not happen.
Migration 0005 queues new wallet entries, withdrawal status updates, and saved marketplace purchase deliveries atomically using PostgreSQL triggers; it does not backfill historical emails. Apply it before accepting wallet activity and verify the application role can insert/update the outbox. The worker is separately configured and must be monitored. See the email setup in the main README.
Earlier installations must first establish that
their schema is compatible, and apply any outstanding legacy changes below.
Existing users intentionally get a NULL subject: **Google sign-in will not link
an existing account merely because the email matches**. This includes old
Google-created accounts. Users with a password can use that method; Google-only
users need a secure, operator-assisted recovery process. Verify identity out of
band, examine and reset any untrusted password, and revoke existing sessions
before creating a verified provider binding. Do not bulk-link subjects by email.

## `legacy/`

These older incremental migrations assume tables that nothing in the original
repo created. Apply them only to a compatible database created before the
baseline, and only when they have not already been applied. Skip them on fresh
baselines:

- `001_add_gift_cards.sql`
- `002_add_scheduled_orders.sql`
- `003_add_security_violations.sql`
- `004_add_withdrawals.sql`
- `005_create_payment_topups.sql`
- `006_add_marketplace_accounts.sql`
