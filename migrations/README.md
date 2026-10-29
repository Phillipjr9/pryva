# Migrations

## Fresh database

Run the migration runner. It applies every `*.sql` in this directory in filename
order, records each one in a `schema_migrations` ledger so a re-run is a no-op,
and stops at the first error:

```bash
DATABASE_URL=postgres://... npm run db:migrate
```

It connects with `DATABASE_URL` if set, otherwise with the standard libpq
variables (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`,
`PGSSLMODE`). IAM-authenticated RDS roles have no `PGPASSWORD` and are not
supported -- the application's connection pool needs one too.

The runner exists because this README previously listed six of twelve
migrations. A database built by following that list was missing `0006` order
idempotency, `0007` reconciliation notes, `0008` provider cost, `0009` password
reset tokens and `0010` the required `orders.provider`. None of those fail at
setup time: they fail later, at query time, in the request that needed them.

To apply them by hand instead, run **all** of these in order with
`ON_ERROR_STOP=1`:

```bash
for f in migrations/0000_base_schema.sql migrations/0001_google_subject.sql \
         migrations/0002_shared_rate_limits.sql migrations/0003_withdrawal_idempotency.sql \
         migrations/0004_paystack_transfer_reference.sql migrations/0005_wallet_email_outbox.sql \
         migrations/0006_order_idempotency.sql migrations/0007_order_reconciliation_note.sql \
         migrations/0008_order_provider_cost.sql migrations/0009_password_reset_tokens.sql \
         migrations/0010_order_provider_no_default.sql \
         migrations/0011_email_verification.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || break
done
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
