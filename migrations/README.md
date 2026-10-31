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
# Every four-digit migration, in order. The glob is deliberate: this README has
# twice been the stale list that left a database missing tables, and a glob cannot
# fall behind the directory.
for f in migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || break
done
```

The baseline creates the 12 original application tables and their indexes/foreign keys.
The incremental migrations add the unique nullable Google subject used by
sign-in, the shared rate-limit table, withdrawal request idempotency keys, a durable Paystack transfer reference, the transactional wallet email outbox, order idempotency and reconciliation notes, the provider-cost column, the password-reset and email-verification token tables, the frozen payout payer name, the disposable inbox tables (`0013`), the admin audit log (`0014`), two-factor
enrolment and recovery codes (`0015`), verified-purchase reviews (`0016`), login
lockout (`0017`), reconciliation runs (`0018`), support threads (`0019`) and
WebAuthn credentials and challenges (`0020`).
Back up existing databases before applying migrations and verify the schema before routing traffic.

## Existing databases

An installation already on the baseline must apply every migration after it — the
runner does this in order, so use `npm run db:migrate` rather than a hand-written
list. In particular `0011` adds email verification, `0012` the frozen payout payer
name, `0013` the disposable inboxes and `0014` the admin audit log; skipping any of
them fails at query time in the request that needed it, not at setup time. Missing the
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

## When migrations run

`npm run db:migrate` is part of the Vercel build command, so a deployment applies
migrations **before** the app is built. The command gates it on the environment:

    if [ "$VERCEL_ENV" = "production" ]; then npm run db:migrate; fi && npm run build

That gate is load-bearing. The `PG*` and `AWS_*` variables target development,
preview *and* production — the Vercel RDS integration sets all three by default —
so without it **every PR preview build applied its own migrations to the
production database**, before anyone reviewed or merged the branch carrying them.
An additive, idempotent migration survives that by luck; a `DROP COLUMN` would
not have.

Two consequences when adding a migration here:

- Write it **idempotent and additive** (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE
  IF NOT EXISTS`). Production may already have applied it through an earlier
  build, and the `schema_migrations` ledger is what decides.
- Previews do **not** migrate, so a preview of a branch that needs a new column
  fails until the branch is merged. That is the intended trade-off: a visible
  preview failure beats an invisible production change.

Previews still read and write production data at runtime. Isolating them means
removing `preview` from the `PG*` targets, which is an operator decision, not a
code change.

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
