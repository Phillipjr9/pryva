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

`vercel.json` schedules **one** job (the Hobby plan allows two, and the three
tasks want a defined order rather than three clocks) at 01:20 UTC — 02:20 in
Lagos, after the business day has closed:

| Path | Schedule | What it does |
|---|---|---|
| `/api/cron/nightly` | 01:20 | 1. closes yesterday's books (`reconciliation_runs`), 2. drains the wallet email outbox, 3. runs the auto-refund sweep |

The order is a dependency, not a preference: the close reads the ledger, so it
goes before anything else writes to it. Each step is isolated — an email outage
never stops a refund sweep.

The per-task endpoints still exist and are no longer scheduled; use them for a
manual run:

| Path | What it does |
|---|---|
| `/api/cron/wallet-emails` | drains the wallet email outbox, max four jobs per invocation |
| `/api/cron/auto-refund` | **refuses persistent databases**; preview-only sweep |
| `/api/cron/daily-reconciliation` | one day's close; `?day=YYYY-MM-DD` backfills |

Check the close actually ran: `/admin/reconciliation` lists the last fourteen
days, and a missing row for yesterday is the signal that the cron is not firing.
A day marked **attention** means the wallet ledger did not add up — see §6a.

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

### The daily close, and what to do when it says "attention"

Every morning, look at `/admin/reconciliation` → **Daily close**:

1. **A missing row for yesterday** means the cron did not run. Check the job in
   the Vercel dashboard and the deploy's `CRON_SECRET`; then backfill it:
   `curl -H "Authorization: Bearer $CRON_SECRET" "https://<domain>/api/cron/daily-reconciliation?day=YYYY-MM-DD"`.
2. **A row marked `clean`** means the day's totals were recorded and every
   account's ledger added up. Compare the **deposits** figure with the settled
   total in the Paystack dashboard for the same Lagos day. A difference is a real
   finding: a payment we never credited, a duplicate credit, or a chargeback.
3. **A row marked `attention`** means the wallet ledger does not add up. The page
   lists the accounts and the difference. Do **not** edit a balance to make it
   match — that hides the cause and destroys the evidence. Instead open
   `/admin/transactions` filtered to that account and find the transaction whose
   running balance does not follow. The usual causes are a hand-written `UPDATE`,
   a credit committed without its ledger row, or a debit applied twice.
4. Record what you found in the run's `notes` (or in the incident log) even when
   the answer is "provider-side, expected".

The close never writes to a money table. Only the person at the keyboard does, and
only through the pages that audit it.

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

## 7a. Review moderation

Reviews are written by customers whose order was delivered, and are **pending
until an operator publishes them**. `STATUS.md` §16 has the full rule set.

- **Publish** when the review describes a real experience and contains no phone
  numbers, emails, credentials, other people's data, supplier names or abuse.
  Strip those by rejecting with a note, not by editing the text.
- **Reject** with a note the customer will read ("contains a phone number").
  They see the note on `/dashboard/reviews`; write it for them, not for yourself.
- **Do not** seed reviews, import them from another site, or copy a testimonial
  into the table to make the page look populated. An empty `/reviews` page says
  it is empty, and that is the honest state.
- **Do not** publish a review on an order that was refunded after delivery
  without mentioning it. The review stays tied to the order; check it first.
- The customer's email is visible in `/admin/reviews` and nowhere public. Keep it
  that way: the public page selects no identity fields at all.

## 7b. The support queue and the assistant

Every customer ticket is answered by the support assistant first, in the same
request, after it has read that account. `/admin/support` is what is left; it
sorts by **least confident first**, because those are the ones worth opening.

**What the assistant is allowed to do on the customer's behalf** (and nothing
else — `src/test/support-surfaces.test.tsx` fails if this list grows silently):

| Remedy | What it does | What it cannot do |
|---|---|---|
| `recheck_topup` | asks Paystack about one unsettled deposit and credits the wallet **only** if the provider confirms it, through the same idempotent path as the webhook | credit an unconfirmed charge, retry a failed payment, or touch another account's reference |
| `resend_verification` | issues one fresh email-verification link, rate-limited per account | send it anywhere but the account's own address, or claim success when mail is unconfigured |
| `cancel_schedule` | stops one of the customer's own scheduled orders | touch anyone else's schedule |

**What it escalates, always:** refunds, withdrawal approval, payout problems,
account locks, switching off two-factor, anything it cannot see, and anything a
customer explicitly asks a person about. An escalated ticket carries its whole
trail — the options it scored, the evidence, what it ran, what the verification
said — so you are reading a diagnosis, not a complaint.

**Working the queue:**
1. Open the oldest `escalated` ticket first. Read the trace block under the
   assistant's reply: it names the playbook, the confidence and the exact facts it
   used. **If a fact there is wrong, the bug is upstream** (a missing ledger row, a
   stuck order), not in the assistant — fix the fact.
2. Reply and set the state. A reply defaults to **Resolved**; choose `escalated`
   to keep it in the queue, or `waiting_on_customer` if you have asked something.
3. Every reply is written to the thread and the audit log (`support.reply`).

**Two things not to do.**
- Do not let the assistant's wording stand in for an investigation. It reports
  what the database says; if the database is wrong, saying it again does not fix
  it.
- Do not switch on the prose model to make answers sound friendlier while a
  `SECURITY.md` gap is open. It is off by default for a reason and it never
  changes a decision, only the wording.

## 7c. Passkeys (WebAuthn)

A passkey is an alternative to the password, not an addition to it: signing in with
one creates the session **without** a second step, because the device has already
proved possession and the customer has already touched a biometric sensor or typed a
device PIN.

**Setup.** Nothing is required for local development — the request's own origin is
used on `localhost`. In production, set `NEXT_PUBLIC_SITE_URL` (or `WEBAUTHN_ORIGIN`)
to the exact public origin. If the routes answer `503 "Passkeys are not available on
this address"`, the server refused the relying party: the configured origin is not
HTTPS, or `WEBAUTHN_RP_ID` is not a suffix of it. Fix the configuration; do not add a
fallback to "trust the Host header", which is the thing the check exists to prevent.

**Changing the domain.** Existing passkeys stop working when the RP ID changes — that
is WebAuthn behaving correctly, not a bug. Announce it, keep password sign-in open,
and let customers re-enrol. Never silently move an origin: the credentials are bound
to it.

**A customer with no devices left.** There is no passkey recovery code by design. They
sign in with the password and, if two-factor is on, with a recovery code. Only if both
are gone does §8's identity check apply.

**Suspected cloned credential.** We store the signature counter, and a counter that
goes backwards refuses the sign-in and writes a warning to the log — search for
"possible cloned credential". The refusal is correct; investigate the account. Do not
delete other credentials to "clean up": removing the customer's remaining devices is a
lockout, not a fix.

**Removing one.** `/dashboard/settings#security` for the customer; `DELETE
/api/security/passkeys/<id>` is scoped to the session's own account, so an operator
cannot use it to remove someone else's device. If you must, do it with the customer on
the line, and record why.

## 7d. Referral rewards

A customer shares a code; when the invited account's **first delivered** order exists,
the inviter is credited **5% of it, capped at ₦2,000**, once per invited account. The
rate lives in `REFERRAL_REWARD_PERCENT` and the cap in `REFERRAL_REWARD_CAP_NGN`; set
the percentage to `0` to stop new rewards without a deploy (existing rows keep their
state).

**Where to look.** `/dashboard/referrals` is the customer's view. In the database,
`referrals` has one row per invited account: `status` is `pending` until settlement,
then `credited`, and `reward_reference` is the wallet ledger reference
(`REFL-…`) — quote it when matching a reward to its ledger entry. `referral_codes` maps
a code to the account that owns it.

**Settling is idempotent.** Both the purchase path and the nightly job call the same
function; re-running it cannot double-pay, because the row is claimed by a conditional
update and the ledger reference is unique. Do not "fix" a stuck reward by editing a
balance — re-run the nightly job (`/api/cron/nightly`) and read the `referrals` step in
its output.

**Suspected abuse** — self-referral rings, accounts created to farm the cap, or a
refunded order that was already rewarded:
1. Establish the link: `referral_codes.code` → owner, then `referrals` rows for that
   owner, then the invited accounts and their first orders.
2. Mark the referral `void` and record why. Do not delete the row: the paper trail is
   the point.
3. If a reward was already paid, reverse it through the admin wallet adjustment so the
   ledger keeps both entries, and note the referral id in the audit row.
4. Reward farming with fresh accounts is a signup problem as much as a referral one —
   check whether disposable inboxes were used, and record what you find.

**Changing the offer.** Raising the percentage or the cap applies to *future*
settlements only; already-credited rows keep the amount they were paid at. Say so if
you change it, because customers will notice the difference.

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

## 8a. Backups and the restore drill

Two copies, because they fail differently:

| Copy | Taken by | Covers | Where the truth lives |
|---|---|---|---|
| Provider backups / PITR | the database provider | every write, to the minute | the provider's console — **turn it on and check the retention date** |
| Logical snapshot | `npm run db:backup` | every table's rows at one instant | wherever you put the file (see below) |

The second exists because the first is invisible from here: nothing in this
repository can prove the provider's backups are on, or restore one.

### Taking a snapshot

```bash
DATABASE_URL=postgres://... npm run db:backup -- --out ./backups --keep 14 --label nightly
```

It writes `backups/pryva-backup-YYYYMMDD-HHmmss.ndjson.gz` (UTC), verifies the
file's checksums before it prunes anything older, and prints a summary. The
archive holds **schema-independent data only**: a manifest (instant, migrations
applied, per-table row count and SHA-256, foreign-key edges) followed by one line
per table. The schema itself comes from `migrations/`, which is what
`npm run db:migrate` replays — that is why the restore needs a migrated database
rather than a schema dump.

Verify a file at any time without restoring it:

```bash
npm run db:verify-backup -- backups/pryva-backup-20261030-031500.ndjson.gz
```

**Move the file off the machine.** A snapshot on the same disk as the app is not
a backup. Put it in object storage with versioning and a lifecycle rule, in a
different account from the database, and keep the credentials out of the app's
environment. That transfer is deliberately not automated here: it needs a bucket
and an access policy that belong to the owner, not to this repository.

### The restore drill

Do this **before** you need it, into a throwaway database, once a quarter. A
backup nobody has restored is a file, not a backup.

```bash
# 1. a new, empty database
createdb pryva_restore

# 2. the schema, from the migrations the archive was taken against
DATABASE_URL=postgres://.../pryva_restore npm run db:migrate

# 3. the rows, parents first, in one transaction
npm run db:restore -- \
  --file backups/pryva-backup-20261030-031500.ndjson.gz \
  --target postgres://.../pryva_restore \
  --confirm-restore
```

The script refuses to run without `--confirm-restore`, refuses if the archive
fails its checksums (before writing a single row), and refuses a target that
already has rows unless you pass `--allow-overwrite`. It also refuses to restore
into the database `DATABASE_URL` points at — restore into a new database, check
it, then switch the application over.

Then check the things that matter, in this order:

1. **Wallet ledger.** Every `wallet_transactions` row's `balance_after` must line
   up with the running sum for its user. A restore that loses a transaction is
   worse than no restore, because it looks fine.
2. **Orders against the payment provider.** Count and sum for a recent day on
   both sides (`/admin/reconciliation` shows the operator's queue).
3. **Sign-in.** A test account can authenticate, and a session cookie is issued.
4. **Money that is mid-flight.** Any withdrawal or order in a pending state is
   expected to stay pending; do not "fix" it by hand.

Record the date of the last successful drill in the table below. If the drill
fails, the backup is not real until it passes.

| Drill date | Archive | Restored rows | Ledger checked | Notes |
|---|---|---|---|---|
| _not yet run_ | | | | |

### What is not covered

- **Writes after the snapshot.** Only PITR closes that gap.
- **Very large tables.** `db:backup` reads one table into memory at a time; a
  table bigger than the machine fails loudly rather than truncating. Past that
  size, use `pg_dump -Fc` from a host that has it.
- **Secrets and `.env`.** They are not in the database and not in this archive.
  Back them up where your secret manager lives.

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
- Do not edit a review's text in SQL, publish it without checking the order, or
  seed the table with borrowed testimonials. A review is a customer's statement;
  the only two decisions are publish and reject, and both are audited.
- Do not "fix" a two-factor lockout by unsetting `TWO_FACTOR_KEY` or deleting rows
  in bulk. The first is a fail-closed outage, the second silently removes a
  security control from every account it touches.
- Do not let the service worker cache HTML, `/api` responses or anything carrying
  account data. It is shared by every profile on the device. Static, content-hashed
  assets and the offline page are the whole approved list; bump `VERSION` in
  `public/sw.js` when changing the rules, or old caches survive the deploy.
- Do not write `text-[0.…rem]` below `0.8rem` in a component, and do not put a
  form control below 16px on a phone. The first is unreadable at arm's length,
  the second makes iOS Safari zoom the page on focus and leave it zoomed — the
  "I have to adjust the zoom" complaint. Use `text-micro` / `text-meta`, which
  carry a 13px floor under `sm`; `src/test/mobile-layout.test.tsx` fails if the
  small sizes come back.
- Do not wrap a `<table>` in `overflow-hidden`. It rounds the corners and also
  cuts off the last columns, which is unreachable data rather than a cosmetic
  flaw. Use `overflow-x-auto` with a `min-w` on the table.
- Do not edit a file under `public/images/services/` or `public/images/categories/`
  whose name ends in `-64.webp`, `-128.webp` or `-192.webp`. Those are generated by
  `npm run artwork:build` from the PNG masters; change the master and regenerate,
  or the next run silently reverts your edit. The masters stay in the repository as
  the fallback `src` and as the thing the derivatives are built from.
- Do not draw a brand mark by eye, generate one with an image model, or "borrow" a
  nearby logo as a fallback. Real marks come from `scripts/extract-brand-marks.mjs`
  (CC0/MIT sources) and are never hand-edited; a brand with no redistributable mark
  gets a wordmark tile from `WORDMARK_BRANDS`, and that list is pinned by a test to
  the five brands that genuinely have none. A cross-service fallback is how a page
  ends up showing another product's logo for months — `ServiceIcon` and
  `NetworkBadge` now render a neutral named tile instead.
- Do not add a third-party script, font, style or image host, or an iframe, without
  extending the policy in `src/lib/security-headers.ts`. The browser will block it
  and the page will look broken in a way the server logs never show. Never put a
  bare `*` in `script-src`, `style-src` or `connect-src` to "make it work".
- Do not leave `ADMIN_2FA_REQUIRED=false` set. It exists to get one administrator
  back in after a lost phone and lost recovery codes; leaving it off removes the
  second factor from every account that can approve a withdrawal or issue a
  refund. Turn it off, fix the enrolment, turn it back on, and say so in the
  incident log.
- Do not "fix" a wallet balance by editing `users.wallet_balance`. The nightly
  close compares that column with the account's ledger, and a hand edit is exactly
  what it is built to catch. Correct the transaction that is wrong, or reverse it
  with a new ledger entry.
- Do not run `npm run db:restore` against a database the app is serving. It
  refuses by default and with `--allow-overwrite` it will happily write rows into a
  live database, which is a data-loss event with a confirmation flag.
- Do not link `fonts.googleapis.com` (or any font CDN) again. The webfonts are
  self-hosted from `@fontsource` packages imported in `src/app/layout.tsx`, which
  is why `style-src` and `font-src` are plain `'self'`. A `<link>` to Google would
  be blocked by the policy, and re-adding the hosts to make it work puts a
  render-blocking third-party request back on the critical path. To add a weight,
  import that weight's CSS file; to add a family, install the `@fontsource`
  package and add the family to the `--font-*` variables in `globals.css`.

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
