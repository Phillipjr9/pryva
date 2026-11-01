# What is still missing

Written 1 November 2026, at `66d08ea`. This is the backlog that
`SERVICES-COMPLETENESS.md` points at: that file says what each service can do
today, this one says what is absent, why it matters, and what unblocks it.

Order is "what would hurt first", not an estimate. Nothing here is a bug that
takes money today — the four that did (scheduled runs, gift-card refunds,
undeliverable plans on `/proxies`, eSIM QR) are fixed. These are the absences.

## P0 — exposure before the next naira of volume

### 1. No identity verification and no tiered limits
Anybody with a working email can hold a balance, receive transfers from other
users and withdraw to a bank account. There is no BVN/NIN check, no date-of-birth
or address step, no tier (verified/unverified) and no per-tier ceiling. The only
friction is the debit-card name rule on withdrawal, which is an anti-fraud control,
not an identity one.
*Evidence:* `src/app/api/auth/signup/route.ts` (name, email, password only);
`src/app/api/wallet/withdraw/route.ts` (₦1,000–₦5,000,000, no identity state);
no `kyc|bvn|nin` table in `src/db/schema.ts`.
*Unblocks:* a decision on which provider (Prembly/Dojah/etc.) and which tier
limits. Then schema + a step in signup + a gate in withdraw.

### 2. Nothing reports an error in production
There is no error tracker and no alert channel. A 500 is a line in the platform
log that nobody reads until a customer writes in; the nightly cron's own failure
report is only visible if somebody opens the endpoint. `logger` is structured and
good, but nothing aggregates it.
*Evidence:* no `@sentry/*`, `posthog`, `datadog` in `package.json`; `src/lib/logger.ts`
writes to console only.
*Unblocks:* a DSN (Sentry free tier is enough) and an alert address. Half a day.

### 3. CI cannot run
`.github/workflows/ci.yml` exists but Actions is billing-locked, so every gate in
this repo is run by hand. The suite is strong (1,775 tests) and worthless if a red
build can be merged.
*Unblocks:* billing on the GitHub account, or a second runner. Nothing in the code.

### 4. Email ownership is never required
Password signup sends a verification link, and the app works whether or not it is
clicked. A purchase, a wallet top-up and a withdrawal all proceed unverified, so an
address nobody controls can hold money and receive order email.
*Evidence:* `src/app/dashboard/layout.tsx:37` shows a banner when
`emailVerifiedAt` is null; `src/app/api/orders/route.ts` does not read it.
*Unblocks:* a decision — block at first top-up (my suggestion) or at withdrawal.
Blocking everywhere would break the shared demo and existing accounts.

### 5. Migrations 0028, 0029 and 0030 must be applied
The eSIM delivery email, number-code email and payout-name approvals each shipped
with a migration. Deploying the code without them fails at runtime, not at build.
*Run:* `npm run db:migrate` against production, then verify with
`migrations/README.md`'s checks.

## P1 — the gaps a customer will meet

### 6. eSIM has one supplier, so it has no failover
Fleexa has no eSIM endpoint; Bitcall is the only path. Your standing rule is that
every product fails over. Today an eSIM outage is an eSIM outage.
*Unblocks:* a second eSIM credential with an activation-code API.

### 7. Boosts have one panel, and a completed boost is never emailed
`isSmmPanelConfigured()` gates the whole service; there is no second panel. And
`wallet-email-outbox.ts` has no `boost_complete` event, so delivery is only visible
on the order page.
*Unblocks:* a second panel (rare for SMM) and a small outbox event.

### 8. Resend only works for Bitcall-issued numbers
`src/lib/otp-resend.ts` asks Bitcall and refuses otherwise, so a Fleexa order whose
code never arrives gets an honest refusal instead of a retry.
*Unblocks:* nothing but code — the Fleexa client has no resend call, so this needs
a decision (buy a replacement number at our cost, or keep refusing).

### 9. No statement or receipt a customer can keep
The wallet page lists transactions; there is no CSV/PDF statement, no per-order
receipt download, and no yearly summary. Admin can export (`/admin/export`), the
customer cannot. For a payments product this is the first support request you will
get at tax time.
*Evidence:* `src/app/dashboard/wallet/` renders a list only; `src/lib/email-templates.ts`
has `orderConfirmationEmail` / `refundEmail` / `walletTopupEmail` templates that no
code calls.

### 10. No dispute or chargeback handling
`dispute` appears in the privacy and refund copy and nowhere in code. A Paystack
dispute on a top-up arrives as an event nobody handles: there is no state, no
freeze, no evidence trail.
*Evidence:* `src/app/api/webhooks/paystack/` handles charge success and transfer
outcomes; `grep -ri dispute src` matches only marketing pages.

### 11. Bounces and complaints are ignored
`RESEND_API_KEY` sends; nothing consumes Resend's bounce/complaint events. An
address that hard-bounces is retried forever by the outbox, which burns sender
reputation — the one asset that decides whether receipts arrive at all.

### 12. Withdrawal has a floor and a ceiling but no velocity
₦1,000 minimum, ₦5,000,000 maximum, one bank-name rule, and no per-day, per-account
or new-account hold. A compromised session can attempt a large payout immediately.
`/admin/reconciliation` shows pending payouts, so a human can catch it — after the
fact, if they are looking.

## P2 — completeness and polish

| # | Missing | Note |
|---|---|---|
| 13 | Notification preferences | Notifications exist (`/api/notifications`); no way to opt out of email. |
| 14 | A welcome email | `welcomeEmail()` exists, uncalled. Signup sends verification instead. |
| 15 | Residential proxies | No supplier. Catalogue only, and the copy now says so. |
| 16 | Mobile data & airtime | No supplier; both routes fail closed. |
| 17 | Subscriptions / digital products | No supplier. |
| 18 | Per-app verification codes | `vn-otp-5` is listed with no app mapping; not sellable. |
| 19 | Search across orders and services | Dashboards filter; nothing searches. Grows painful past a few hundred orders. |
| 20 | Dead templates | `welcomeEmail`, `orderConfirmationEmail`, `refundEmail`, `walletTopupEmail` render nothing anywhere — delete or wire, don't leave them to imply coverage. |
| 21 | Accessibility sweep | Contrast and focus states are partly tested (`mobile-layout.test.tsx`); no screen-reader pass. |
| 22 | `npm audit`: 20 moderate | Production dependencies are clean (`npm audit --omit=dev` → 0); the moderates are dev-only, in the lint/test chain. |
| 23 | GitHub Actions | See P0.3 — the same billing block means no scheduled dependency audit either. |

## What is *not* missing (checked, so nobody rebuilds it)

Two-factor auth and passkeys with a settings screen; database-backed rate limits
(shared across instances, fail-closed); 30-day sessions; backup, verify and restore
scripts; security-header checks; sitemap and robots; privacy, cookie, terms and
refund pages; referral rewards; order reviews; support tickets with an assistant;
account deletion and data export; admin audit log; ledger-break detection;
reconciliation aging; verification-code and eSIM emails through a retrying outbox.
