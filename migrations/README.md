# Migrations

## Applying to a fresh database

Run one file, in order:

```bash
psql "$DATABASE_URL" -f migrations/0000_base_schema.sql
```

`0000_base_schema.sql` is generated from `src/db/schema.ts` by Drizzle Kit and
creates **all 12 tables** (`users`, `sessions`, `orders`, `wallet_transactions`,
`payment_topups`, `contact_messages`, `gift_cards`, `scheduled_orders`,
`notifications`, `security_violations`, `withdrawals`, `bank_accounts`) with
their indexes and foreign keys.

Regenerate it after schema changes:

```bash
npx drizzle-kit generate --name <what_changed>
```

## `legacy/`

These are the incremental `ALTER TABLE` migrations written before the base
schema existed. They assume tables that nothing in the repo created, which is
why `0000_base_schema.sql` is now the starting point.

- `001_add_gift_cards.sql`
- `002_add_scheduled_orders.sql`
- `003_add_security_violations.sql`
- `004_add_withdrawals.sql`
- `005_create_payment_topups.sql`
- `006_add_marketplace_accounts.sql`

**Only run these against a database that was created before `0000_base_schema.sql`**,
and only the ones it hasn't seen. On a fresh database they will fail with
"column already exists" — that is expected and harmless, but skip them.
