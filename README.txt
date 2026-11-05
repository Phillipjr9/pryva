PRYVA
=====

Next.js application for a wallet and digital services. Availability depends on
configuration and the actual service readiness checks; example eSIM cards are
not orderable. Preview data, provider configuration and production fulfilment
are different things. A configured provider does not by itself prove live stock
or a successful customer delivery.

Local development
-----------------

  npm ci
  cp .env.example .env.local
  npm run dev

Without a persistent PostgreSQL connection the application uses its in-memory
preview database. The email worker and eSIM purchase paths refuse this database;
other integrations and hosting credentials must also be isolated from production.
.env.example documents configuration names and contains placeholders only. Do not
commit populated environment files.

Useful checks (Node 22)
-----------------------

  npm run typecheck
  npm run lint
  npm test
  npm run pricing:audit -- --check
  npm audit --omit=dev --audit-level=high
  npm run build

Provider calls and PostgreSQL in tests are mocked or run in embedded PGlite;
they do not prove live provider, browser, delivery or multi-server behaviour.
See OPERATIONS.txt before migrating, configuring a sender, restoring a database,
or touching a payout. SECURITY.txt explains the threat model and known gaps.

Database migrations
-------------------

  npm run db:migrate

Set the database connection through your environment or secret manager first.
The runner supports DATABASE_URL, standard PG* variables, and RDS IAM via Vercel
OIDC when the required PG*/AWS_* variables are configured. The IAM path outside
Vercel also needs a valid VERCEL_OIDC_TOKEN.

The runner applies top-level numbered migrations in order and records each one;
legacy migrations are excluded because they assume a different old schema. Back
up the database first. The production build is configured to run migrations before
building; preview builds do not. Migrations must therefore be reviewed for
compatibility with the old application, which may still be serving traffic.
Migration 0034 deliberately removes delivery snapshots, passkeys and pending
email-change requests associated with already closed accounts; financial ledger
rows remain.

Pricing
-------

The pricing policy, floor and exceptions live in src/lib/pricing.ts. Static
catalogue costs are in data/cost-sheet.json, and the generated customer prices
are in src/lib/prices.generated.ts. When a verified cost changes, regenerate and
check the catalogue:

  npm run pricing:build
  npm run pricing:audit -- --check

The cost sheet contains estimated values, not confirmed provider invoices; the
calculated markup is meaningful only when actual costs and exchange rates are
verified. Temporary inboxes are free. Airtime, data and gift cards have face-value
exceptions. Never publish cost sheets in customer-facing responses or bundles.
