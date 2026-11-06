PRYVA
=====

Next.js application for a wallet and digital services. Availability depends on
configuration and the actual service readiness checks; example eSIM cards are
not orderable. Preview data, provider configuration and production fulfilment
are different things. A configured provider does not by itself prove live stock
or a successful customer delivery.

Project layout
--------------

Business logic lives under src/lib, grouped by domain rather than by file type:
platform (infrastructure), identity, payments, services (one folder per product
family), providers (supplier adapters), checkout (the shared money gates), admin,
content, support and email. ARCHITECTURE.txt explains which module owns each
decision, the invariants tests enforce, and how to add a service, a supplier or a
purchase route.

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

Admin console
-------------

The operator console at /admin uses an AdminLTE-inspired shell and dashboard.
The stylesheet is built from the MIT-licensed admin-lte 4.10.0 package and scoped
to .admin-app so it cannot restyle the customer storefront:

  npm run admin:theme

The rebuilt overview at /admin/overview reports database-derived totals, queues
and delivered-order revenue for 7/30/90-day UTC windows; /admin/dashboard redirects
there while preserving the selected period. Integrity checks are read-only and
must not be used as a payout or refund control. Operator authentication, admin
authorization and 2FA remain the existing requireAdmin/authorizeAdminApi paths.

To review the console in a preview pane, which otherwise opens the storefront,
set PREVIEW_LANDING_PATH=/admin/overview alongside the preview bootstrap. It only
applies with no persistent database and only redirects `/`, on every visit, so a
pane reload keeps opening the console. The storefront stays reachable at
/?storefront=1 (the console's "View storefront" link) and at every other path. It
is a landing convenience, not an access control: /admin still runs requireAdmin on
every request, so a signed-out visitor lands on the operator sign-in page.

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
The current version of migration 0034 leaves existing closed-account snapshots,
passkeys and pending email-change requests untouched. An earlier version was
already applied in production and contained deletes for those closed-account
records; deployment logs do not report how many rows matched. The migration
ledger does not re-run an edited file, and this change cannot restore deleted
rows. Any investigation or restoration needs separate owner authorization.
The current email worker skips closed accounts; remaining historical sensitive
records also require a separately authorized privacy review.

Pricing
-------

The pricing policy, floor and exceptions live in src/lib/services/pricing.ts. Static
catalogue costs are in data/cost-sheet.json, and the generated customer prices
are in src/lib/services/prices.generated.ts. When a verified cost changes, regenerate and
check the catalogue:

  npm run pricing:build
  npm run pricing:audit -- --check

The cost sheet contains estimated values, not confirmed provider invoices; the
calculated markup is meaningful only when actual costs and exchange rates are
verified. Temporary inboxes are free. Airtime, data and gift cards have face-value
exceptions. Never publish cost sheets in customer-facing responses or bundles.
