# Pryva operations runbook

What to do when something needs doing, and what not to do because it moves money.

Read this with [`README.md`](README.md) (what the app promises and its limitations),
[`migrations/README.md`](migrations/README.md) (schema) and [`STATUS.md`](STATUS.md)
(what is and is not built). This file is the operator's day-to-day companion.

> **Nothing in this repository is a substitute for staging.** Suppliers, Paystack
> and Resend are mocked in the test suite. Before any live money, work through the
> staging checklists in the README with test credentials and a separate database.

---

## 1. What is live, and what only looks live

| Live when configured | Requires | Source of truth |
|---|---|---|
| Wallet top-ups | `PAYSTACK_SECRET_KEY`, `NEXT_PUBLIC_APP_URL` | `payment_topups` + `wallet_transactions` |
| Withdrawals (manual settlement) | the above, plus an operator | `withdrawals` |
| Virtual numbers and rentals — 10 of 37 plans | number-provider key, margin floor | `orders`, fulfilment allowlist in `src/lib/fulfillment.ts` |
| Account marketplace checkout | `BULKACC_API_KEY` (legacy lane also needs `MARKETPLACE_LIVE_PURCHASES=true`) | `orders`, supplier balance |
| Gift cards | wallet balance only | `gift_cards`, `wallet_transactions` |
| Disposable inbox (free tier) | number-provider key | `disposable_inboxes`, `inbox_messages` |

**Demo-only / disabled:** eSIM, proxies, digital subscriptions, airtime/data, bulk
orders, scheduled orders, SMM boosting, live auto-refunds. Their routes return an
actionable `503` rather than pretending. Do not "fix" a `503` by removing the guard
— that turns an unavailable product into an unfulfillable charge.

The in-memory demo (`DATABASE_URL` unset) never calls a supplier, even with a live
key present. Demo funds cannot withdraw or purchase outside the preview.

---

## 2. Environments

- **Preview / demo** — no `DATABASE_URL`. Everything is process-local and lost on
  restart. Never use it for money or for a multi-instance deployment.
- **Persistent** — `DATABASE_URL`, or the `PG*` variables minted from
  `AWS_ROLE_ARN` through Vercel OIDC. Health is `GET /api/health`, which returns
  `{"status":"healthy","mode":"database"}` or `503` with no detail.
- **Arena preview hosts** — protocol/cookie exceptions exist only for the exact
  sandbox host. A custom domain must supply correct trusted proxy headers.

⚠ **Preview deployments currently read and write the production database** because
the `PG*` variables target `development`, `preview` and `production`. The
migration step is gated; runtime data access is not. Removing `preview` from those
targets is an operator decision that changes how the owner tests.

---

## 3. Deploying and migrating

The build command in Vercel is:

```sh
if [ "$VERCEL_ENV" = "production" ]; then npm run db:migrate; fi && npm run build
```

**The gate is load-bearing.** Without it every PR preview applied its migration to
production before review. Keep it. Previews intentionally do not migrate, so a
preview of a branch that needs a new table can fail until the branch merges — that
is the intended trade-off.

`npm run db:migrate` applies every `migrations/*.sql` in filename order, records
each in `schema_migrations`, stops at the first error, and is safe to re-run.

Before deploying anything that adds a migration:

1. Back up the database.
2. Write the migration **additive and idempotent** (`CREATE TABLE IF NOT EXISTS`,
   `ADD COLUMN IF NOT EXISTS`). There are no down migrations.
3. Add the file to the four PGlite fixtures under `src/test/` — their own guard
   (`withdrawal-name-check.test.ts`) fails until you do.

To roll back a bad deploy: restore the database backup, then redeploy the previous
build. Never hand-edit `schema_migrations`.

---

## 4. Secrets

| Variable | Purpose | Rotation |
|---|---|---|
| `PAYSTACK_SECRET_KEY` | checkout init, verification, transfers, webhook HMAC | rotate in Paystack, then the host; webhook signatures fail closed without it |
| `CRON_SECRET` | bearer for the cron routes | rotate in the host and in whatever calls the jobs |
| `DIAGNOSTICS_SECRET` | bearer for the read-only integration probe | rotate independently; `CRON_SECRET` is still accepted as a fallback |
| `TWO_FACTOR_KEY` | encrypts every stored TOTP secret (AES-256-GCM, scrypt-derived; at least 16 characters) | **rotating it locks out every account with 2FA enabled** — they still hold the factor, the server can no longer read it. Clear the affected enrolments deliberately, one at a time, after verifying identity (see the playbook) |
| `ADMIN_EMAILS` | the only source of administrator identity | edit deliberately; a match still requires a **verified** email |
| Supplier keys (`BULKACC_API_KEY`, `FLEEXA_API_KEY`, `ACCSZONE_API_KEY`, `BITCALL_*`) | catalog and fulfilment | rotate at the supplier, then the host |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | wallet email outbox | rotate in Resend; the outbox retries, so a short outage is recoverable |

A key that merely *exists* is not a key that *works*: probes report per-feed
balance, product counts and the last four characters only. Treat every supplier
key as spendable and test it read-only first.

**If a key leaks:** revoke it at the provider first, then replace it in the host.
Removing it from the environment does not invalidate the leaked value.

---

## 5. Scheduled jobs

`vercel.json` schedules two daily jobs (the Hobby plan's limit):

| Path | Schedule | What it does |
|---|---|---|
| `/api/cron/wallet-emails` | 03:10 | drains the wallet email outbox, max four jobs per invocation |
| `/api/cron/auto-refund` | 03:40 | **refuses persistent databases**; preview-only sweep |

`/api/cron/scheduled-orders` is **not scheduled on purpose**. It exports only
`POST`, while Vercel Cron sends `GET`, so scheduling it would register a job that
is answered `405` forever. `src/test/cron-schedule.test.ts` pins that, plus the
two-job daily limit. Run it by hand when you need it:

```sh
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-domain>/api/cron/scheduled-orders
```

⚠ **The wallet email worker needs a per-minute cadence** to honour the 23-hour
outbox cutoff described in the README; once a day cannot. Either move to Vercel
Pro (`* * * * *`) or call the endpoint from an external scheduler at least once a
minute and alert when it is not `200`. This is an open operator decision, not a
code bug.

---

## 6. Money operations

### Top-ups
A credit requires a matching pending `payment_topups` row, the right currency and
the right amount; the status change, wallet credit and ledger entry commit
together. A repeated webhook cannot credit twice. **A redirect is not a payment** —
only a committed ledger entry is. If a verification fails, do not ask the customer
to pay again until you have checked Paystack by reference.

### Withdrawals
`pending → processing → completed`. Approval claims the row and stores a unique
Paystack reference **before** calling Paystack. There is no automatic settlement:
`transfer.success`/`transfer.failed` webhooks are **not** handled.

- An ambiguous transfer stays `processing`. Inspect Paystack by reference, amount
  and recipient before doing anything else.
- `complete` requires the stored initiation code plus `reconciliationConfirmed`
  and a note. It is refused when there is no confirmed initiation.
- `reject` refunds only a `pending` request with no provider reference. Once a
  reference exists, reconcile before refunding.
- Payouts may only go to the name frozen on the top-up that funded the wallet. A
  profile rename cannot redirect money.
- Merchant-side Paystack transfer OTP is not implemented; if Paystack asks for it,
  complete that in the Paystack dashboard and record it in the reconciliation note.

### Refunds
Refunds use `POST /api/admin/refunds`. A `review` order needs
`reconciliationConfirmed: true` **plus** a reason; a `processing` order cannot be
refunded there at all. Refunding money without releasing a still-working unit
flags the order for reconciliation — that flag is deliberate.

### Marketplace orders stuck in `processing` / `review`
There is no automatic resolver. Check the supplier with the recorded provider
reference. If no request is in flight and the outcome is known, refund through the
audited endpoint. Never blindly retry a purchase: the supplier offers no
idempotency key and a retry can double-spend.

### Gift cards
Non-refundable by design, and issued from the buyer's own wallet — no supplier is
involved. Treat support requests to refund one as policy questions, not bugs.

---

## 7. Monitoring

```sh
# readiness, no detail leakage
curl -s https://<your-domain>/api/health

# per-feed supplier facts: balances, product counts, last four of each key
curl -s -H "Authorization: Bearer $DIAGNOSTICS_SECRET" \
  https://<your-domain>/api/diagnostics/integrations
```

The probe is rate-limited by the suppliers, so do not put it on a tight schedule.
Watch for: an empty catalog with a funded balance (mapping problem), repeated
`429`s (shared supplier budget), and an outbox that is not draining (scheduler
problem). The README documents the per-supplier request budgets.

Admin surfaces that answer "what happened": `/admin/orders?status=review`,
`/admin/refunds`, `/admin/withdrawals`, `/admin/fulfilment`, `/admin/messages`,
`/admin/margin`, `/admin/security`, and `/admin/audit`.

The surface that answers **"what is still unresolved"** is `/admin/reconciliation`:
withdrawals in flight, orders with an unknown supplier outcome, refunded orders
whose unit may still be live, and deposits pending for over an hour, oldest
first. It is read-only and does not show account numbers; act on the page that
owns the action so every change lands in the audit log.

**The audit log is best-effort.** Entries are written after the action commits; a
failed insert is logged loudly and is not retried. The wallet ledger is the
authoritative financial record — use the audit log to find *who* acted, the ledger
to prove *what* moved.

---

## 8. Incident playbooks

**Suspected double credit.** Compare `wallet_transactions` references for the
customer with Paystack. Do not "correct" a balance by hand: use the admin wallet
adjustment, which writes a ledger entry and an audit row, and record why.

**Customer says a number still works after a refund.** Reconcile the order and
note it. The refund does not cancel upstream; that is the recorded exposure.

**Webhook not arriving.** Verify the URL, the secret and that the endpoint is
publicly reachable. A signature failure is silent to Paystack by design — check
your own logs. Do not replay historical events; see the README's cutover warning.

**Supplier key rejected.** Confirm the key shape (some clients reject a malformed
secret before any request), then the balance, then the mapping. The probe tells you
which of the three it is.

**Customer locked out by two-factor.** In order:
1. Ask for a recovery code — each is single-use, and there are ten unless some
   have been spent.
2. If the codes are gone, confirm identity out of band (a reply from the account's
   verified email, plus something the account holder knows that a session thief
   would not). Do not accept a support message alone: a stolen session can send one.
3. Only then clear the enrolment for that user: `DELETE FROM user_two_factor`,
   `two_factor_recovery_codes` and `two_factor_challenges` rows for that
   `user_id` in one transaction, and record who authorised it and why in
   `admin_audit_log`. The account returns to password-only until it enrols again.
4. If every account is affected at once, suspect a **missing or rotated
   `TWO_FACTOR_KEY`**, not the customers: restore the previous key value rather
   than mass-clearing enrolments. Setting the variable to empty makes sign-in for
   those accounts return 503 — by design; it does not disable their 2FA.

**Bad deploy.** Restore the backup, redeploy the previous build, and do not let a
preview apply a migration to production by removing the `VERCEL_ENV` gate.

---

## 9. What not to do

- Do not enable live purchases by deleting a `503`. Every guard corresponds to an
  unverified contract or an undeliverable product.
- Do not log credentials, verification codes, full bank account numbers or
  supplier names in customer-facing surfaces or in the audit summary.
- Do not retry an ambiguous purchase or transfer. Reconcile first.
- Do not make the repository public while `data/cost-sheet.json` is committed.
  (It already is public — see `STATUS.md` — so treat wholesale costs as disclosed.)
- Do not apply a migration by hand from a list in a document. Use the runner and
  the glob in `migrations/README.md`.
- Do not "fix" a two-factor lockout by unsetting `TWO_FACTOR_KEY` or deleting rows
  in bulk. The first is a fail-closed outage, the second silently removes a
  security control from every account it touches.

---

## 10. Before you change anything

```sh
npm ci
npm run typecheck
npm run lint
npm run pricing:audit -- --check   # fails if a generated price left the 30–50% band
npm test
npm run build
```

CI runs the same commands on every pull request. If CI cannot start (for example a
GitHub billing lock), run them locally and say so in the pull request — do not
merge on an unrun gate.
