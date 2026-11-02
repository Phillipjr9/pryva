# What is still missing

Written 1 November 2026, re-verified against the code and the live site on
**2 November 2026**. This is the backlog that `SERVICES-COMPLETENESS.md` points
at: that file says what each service can do today, this one says what is absent,
why it matters, and what unblocks it.

Order is "what would hurt first", not an estimate. Nothing here is a bug that
takes money today — the four that did (scheduled runs, gift-card refunds,
undeliverable plans on `/proxies`, eSIM QR) are fixed. These are the absences.

The 2 November pass re-ran every gate and probed production. Corrections are
marked inline: the earlier file said 1,775 tests, quoted a date that had not
happened yet, and still listed search as missing when `/api/search` and the
command palette had shipped.

## P0 — exposure before the next naira of volume

### 1. Identity verification — **declined by the owner, 1 November 2026**
Not wanted: no BVN/NIN step, no date-of-birth or address step, no verified/
unverified tier and no per-tier ceiling. Recorded here only so it is not proposed
again, and so the decision has a date on it.

What does hold the line instead, and is already live: the payout name rule (money
may only leave in the name it arrived in, frozen from the first settled deposit,
with an admin-reviewed override), fraud scoring on every withdrawal request, the
email-verification gate on payouts added in `a52b13e`, the per-request risk level
in the operator queue, and the reconciliation sweep for anything whose outcome is
unknown. That is a fraud-and-reachability posture, not an identity one — accounts
can still be opened with an address nobody has proven they own.

### 2. Nothing reports an error in production — **closed, with one step left**
`logger.error()` now posts to a webhook (`ALERT_WEBHOOK_URL`, Slack or Discord
shape) as well as to the log: throttled to one message per five minutes, values
under credential-shaped keys redacted, never retried, never thrown. That covers
every nightly step failure, every caught route error and every refund that cannot
commit.
*Still needed:* **set the webhook URL in production.** Until it is set, this is
inert by design, and `RUNBOOK.md` §7 says how to prove it works. A full error
tracker with stack traces (Sentry) is still worth having for the browser, but it
is no longer the difference between noticing and not. The 2 November review could
not read production environment variables (see "Unverifiable from here" below),
so whether the URL is set remains an operator check.

### 3. CI cannot run — **verified 2 November 2026**
`.github/workflows/ci.yml` exists and is `active`, but Actions is billing-locked.
The API shows 127 runs; the last 100 are all `failure`, each finishing in about two
seconds with **zero steps**. The job annotation is explicit: *"The job was not
started because your account is locked due to a billing issue."* The suite is
strong (**1,845 tests / 197 files**) and worthless if a red build can be merged.
*Unblocks:* billing on the GitHub account, or a second runner. Nothing in the code.

### 4. Email ownership is never required — **closed at the payout boundary**
Money out now requires a verified address: `/api/wallet/withdraw` refuses with
`403 { code: "EMAIL_UNVERIFIED" }` before it writes a row or debits anything, and
the wallet screen keeps the reason on the page next to the link that fixes it,
instead of the "review or retry" advice that cannot help.

Two deliberate limits: the gate fires **only when mail is configured** (a
requirement nobody can satisfy is a lockout), and it applies **only to money
leaving** — deposits and purchases still work unverified, because the goods appear
on the order page whether or not email delivers. If you would rather require
verification at first top-up as well, that is a one-line change in the same helper
(`unverifiedEmailBlocksPayout`, `src/lib/resend-config.ts`).

### 5. Migrations 0028, 0029 and 0030 must be applied
The eSIM delivery email, number-code email and payout-name approvals each shipped
with a migration. Deploying the code without them fails at runtime, not at build.
`RUNBOOK.md` §2 documents the Vercel build command that applies them on
production only, and `migrations/README.md` says the runner/glob is the authority
(the prose list there stopped at `0020` and is now annotated).
*Still needed:* confirm against the production database that all 31 migrations
are recorded, rather than assuming the build did it.

### What is left in P0
Item 1 is declined. Items 3 (CI billing) and 5 (migrations) need a billing change
and a deploy, which are not code. Item 2 is closed in code and needs one secret
set (`ALERT_WEBHOOK_URL`); item 4 is closed at the boundary where it matters.
Everything else in P0 is an operator or DNS action, not a code change.

## Closed on 2 November 2026 (recorded so they are not reopened)

### A. The canonical domain was never attached — **fixed in code**
`https://pryva.ng` does not resolve; the live site is `pryva-two.vercel.app`.
`robots.ts`, `sitemap.ts`, `structured-data.ts`, `metadataBase` in `layout.tsx`
and five mail builders all hardcoded `https://pryva.ng`, so the live sitemap
listed every URL on a dead host, `robots.txt` pointed at a sitemap nobody can
read, and absolute email images 404d. `src/lib/site-url.ts` now resolves one
origin: pinned `NEXT_PUBLIC_SITE_URL` → `NEXT_PUBLIC_APP_URL` → Vercel's injected
production/deployment host → a local-only fallback. Placeholder values such as
`https://your-domain.com` are refused. `.env.example` now leaves the variable
blank instead of shipping a placeholder, and documents `RESTORE_DATABASE_URL`.
*Still needs the owner:* attach `pryva.ng` (or set `NEXT_PUBLIC_SITE_URL` to the
domain actually serving the site) so crawlers see the canonical brand domain.
`public/.well-known/security.txt` also hardcoded that dead domain; section D
below records its move to the shared resolver.

### B. Public pages promised what checkout refuses — **fixed in code**
`/status` said "Digital subscriptions, data, bulk and scheduled orders —
Available — processed automatically through verified provider integration" while
`/api/digital/purchase` and `/api/airtime/purchase` were permanent 503s. It also
said eSIM was "Not available — none of the 6 plans can be delivered", counting six
written plans that were withdrawn from sale when the live catalogue launched.
`/esim` said "issued the moment you buy" in its hero and "No. eSIM plans are not
available for purchase yet" in its FAQ on the same page. `/status` now derives
every supplier-backed row from `readServiceReadiness()` (the same verdicts the hub
and checkout read), `/esim` switches its whole highlight/FAQ set with the live
gate, and the stale "Scheduled ordering is not launched yet" verdict in
`service-readiness.ts` is corrected — `/dashboard/scheduled` has had a create form
since 1 November. `content-integrity.test.tsx`,
`public-availability-copy.test.tsx` and `site-url.test.ts` now fail if any of this
drifts back.

### C. Three catalogue families had no supplier path — **wired, still disabled**
Data, subscriptions and proxies had written prices and no way to deliver anything:
two purchase routes were permanent 503s and proxies had no route at all. On the
owner's decision to use the already-integrated FoxReload account,
`src/lib/product-mappings.ts` and `src/lib/mapped-purchase.ts` now provide one
fail-closed path shared by `/api/airtime/purchase`, `/api/digital/purchase` and
`/api/proxies/purchase`. Real product IDs go in the server-side
`PRODUCT_MAPPINGS_JSON` variable, **not** the committed template
`data/product-mappings.json` — this repository is public, and the owner rule
against revealing sourcing is enforced by `supplier-secrecy.test.ts` in every
user-facing file and client bundle. Customer-facing 503s are therefore neutral;
`GET /api/diagnostics/product-mappings` gives the operator the exact list.
`readServiceReadiness()` asks the same gate, so the hub and `/status` flip to
"Available" only when a family has a verified product. The purchase sequence
reuses the gift-card route's FoxReload order/pay/poll flow and its debit-then-
refund compensation, adds a live pre-flight check that the product delivers a
**code** (direct top-ups are refused), converts the supplier price to naira and
applies `checkMargin()` before any wallet debit. `GET
/api/diagnostics/product-mappings` reports exactly what is missing.
**The mapping file ships empty, so nothing became sellable.** An operator still
has to add real product IDs and complete a staging purchase — see
`SUPPLIER-PRODUCTS.md`. Per-app verification codes remain read-only because paid
Fleexa purchases are still deliberately off until app/country mapping and
reconciliation are verified.

### D. Hidden listings, untracked units and a dead security contact — **fixed**
The service hub built 199 listings for Nigeria but rendered only 12 at a time,
so whole families looked absent. It now says *"Showing X of Y listings"* and has
a **Show all** control beside *Show more*, and the units footer says plainly that
"Not tracked" means unknown (not zero) and points at the Orders page for bought
units. `security.txt` was a static file whose `Contact` and `Canonical` pointed
at the unattached `https://pryva.ng`, giving a researcher nowhere to report a
problem; it is now served from `src/app/.well-known/security.txt/route.ts` using
`canonicalSiteUrl()`, and `security-posture.test.ts` asserts it follows a live
host. `/esim`'s destination paragraph is now live-aware too.

Three suspected gaps were checked and are **not** gaps: `/status` has exactly one
"Temporary email inboxes" row (the catalogue has no `email-otp` plans, so the
label map never produces a second row — the extra HTML hits are React's flight
payload); `/esim`'s `service.description` was already switched by the live gate;
and `service.intro` is not rendered on any page. Gift cards being absent from the
hub and eSIM having no static hub rows are deliberate, with guards in
`service-explorer.test.tsx` and `dashboard-nav-coverage.test.tsx`.

## P1 — the gaps a customer will meet

### 6. eSIM has one supplier, so it has no failover
Fleexa has no eSIM endpoint; Bitcall is the only path (`esim-fulfilment.ts`
imports it directly). Your standing rule is that every product fails over. Today
an eSIM outage is an eSIM outage.
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

### 9. Statements and receipts — **closed, and the list was wrong about half of it**
The wallet ledger was already exportable: `ExportTransactionsButton` on
`/dashboard/wallet` calls `/api/wallet/transactions/export`, which returns every
row as CSV or JSON. What genuinely did not exist was a document for a **single
order** — the order page is a live screen that polls, changes status and holds the
code or eSIM activation credential, so it is the wrong thing to hand to a bank.

`/dashboard/orders/[id]/receipt` now renders a printable receipt (browser print →
PDF): reference, date, product, plan, region, validity, how it was paid, status in
words, the amount, and the refund date when there is one. It deliberately never
reads `provider`, `otpCode`, `referenceCode`, `accounts` or the eSIM fields, and a
test enforces that, so a receipt can be forwarded without leaking a supplier or a
credential. The order page links to it.

Still missing in this area: a date range on the wallet export (it is all-or-nothing,
verified again on 2 November) and any yearly summary.

### 10. No dispute or chargeback handling — **verified 2 November**
`dispute` appears in the privacy/refund/terms copy and in schema comments, never in
a handler. A Paystack dispute on a top-up arrives as an event nobody handles: no
state, no freeze, no evidence trail.
*Evidence:* the only webhook route is `src/app/api/webhooks/payment/route.ts`
(charge success and transfer outcomes); `grep -ri dispute src` matches marketing
pages and comments only. The earlier file named a `webhooks/paystack/` directory
that does not exist.

### 11. Bounces and complaints are ignored
`RESEND_API_KEY` sends; nothing consumes Resend's bounce/complaint events. An
address that hard-bounces is retried forever by the outbox, which burns sender
reputation — the one asset that decides whether receipts arrive at all.

### 12. Withdrawal has a floor and a ceiling but no velocity
₦1,000 minimum, ₦5,000,000 maximum, one bank-name rule, and no per-day, per-account
or new-account hold. The route has a generic per-user attempt limiter, not a money
velocity limit. `/admin/reconciliation` shows pending payouts, so a human can catch
it — after the fact, if they are looking.

## P2 — completeness and polish

| # | Missing | Note |
|---|---|---|
| 13 | Notification preferences | Notifications exist (`/api/notifications`); no way to opt out of email. |
| 14 | A welcome email | `welcomeEmail()` exists, uncalled. Signup sends verification instead. |
| 15 | Residential proxies — **code wired, not enabled** | A FoxReload-backed `/api/proxies/purchase` now exists. Still no verified product in `data/product-mappings.json`, so every plan stays unpurchasable. See section C. |
| 16 | Mobile data & airtime — **code wired, not enabled** | `/api/airtime/purchase` now maps verified code-delivering FoxReload products. Direct top-ups are deliberately refused (no recipient contract). No mapping yet. |
| 17 | Subscriptions / digital products — **code wired, not enabled** | `/api/digital/purchase` uses the same mapped path; no verified product yet. |
| 18 | Per-app verification codes | `vn-otp-5` is listed with no app mapping; not sellable. |
| 19 | Search across orders and services — **closed** | Was "nothing searches". `GET /api/search` plus the ⌘K/Ctrl+K command palette search the visitor's orders, wallet transactions and gift cards; `ServiceExplorer` searches services. This row was stale, not a gap. |
| 20 | Dead templates | `welcomeEmail`, `orderConfirmationEmail`, `refundEmail`, `walletTopupEmail` render nothing anywhere — only `logo-removal.test.tsx` imports them. Delete or wire, don't leave them to imply coverage. |
| 21 | Accessibility sweep | Contrast and focus states are partly tested (`mobile-layout.test.tsx`); no screen-reader pass. |
| 22 | `npm audit`: 20 moderate | Re-verified 2 November: production dependencies clean (`npm audit --omit=dev` → 0); all 20 moderates are dev-only, in the lint/test chain. |
| 23 | GitHub Actions | See P0.3 — the same billing block means no scheduled dependency audit either. |
| 24 | Browser error tracking and error boundaries | No `error.tsx`, `global-error.tsx` or `ErrorBoundary` anywhere; only `not-found.tsx`. Unhandled render errors fall through to Next's default page, and nothing reports a browser exception. |
| 25 | End-to-end and live-stack tests | 1,845 tests on jsdom + in-process PGlite with mocked providers. No Playwright/Cypress, no separate PostgreSQL server, no multi-instance or live supplier-sandbox pass. |
| 26 | Documentation drift | 12 docs / ~6,350 lines with no single current-state index. `AUDIT.md` O4 still said "no `.github/workflows`"; `migrations/README.md`'s prose stopped at `0020` while `0030` exists; `STATUS.md` (31 Oct) says scheduled orders have no management screen while `SERVICES-COMPLETENESS.md` (1 Nov) says it is fixed. The three concrete contradictions are annotated now, but the older review files are historical. |
| 27 | Three stale open PRs | #34 (docs-only correction), #17 (CI gate, effectively already on `main`), #8 (payment UI, 16 files). Merge or close so the queue means something. |
| 28 | Repo hygiene | No LICENSE, CONTRIBUTING, CHANGELOG, CODEOWNERS, `.nvmrc`/`engines`, dependabot or PR/issue templates. One ESLint warning remains (`InboxManager.tsx:131`, missing `useEffect` dependency). |

## What is *not* missing (checked, so nobody rebuilds it)

Two-factor auth and passkeys with a settings screen; database-backed rate limits
(shared across instances, fail-closed); 30-day sessions; backup, verify and restore
scripts; security-header checks; sitemap and robots (now pointing at a resolving
origin); privacy, cookie, terms and refund pages; referral rewards; order reviews;
support tickets with an assistant; command-palette search across orders,
transactions and gift cards; a printable per-order receipt; account deletion and
data export; admin audit log; ledger-break detection; reconciliation aging;
verification-code and eSIM emails through a retrying outbox.

## Unverifiable from here

The connected Vercel app is scoped to a different account ("Team Jolash's
projects") with no `pryva` project and no domains, so production environment
variables, deployment settings and the `schema_migrations` table could not be
read. The public site was probed instead: `/api/health` returns
`{"status":"healthy","mode":"database"}` and `/api/version` reports build
`4ed852600ad1c55bdd56ab8f0b1b803a57d666cb`, which is `main`'s HEAD — so the
live site is running this code, and everything above about it is in the code,
not a stale deployment. What still needs eyes inside the project settings:
`ALERT_WEBHOOK_URL`, `NEXT_PUBLIC_SITE_URL`, the 31 applied migrations, and
whether the Paystack/Resend/supplier webhooks are registered.

## Verified in this pass (2 November 2026)

`npm ci` clean · `typecheck` 0 errors · `lint` 0 errors / 1 warning · **1,845
tests / 197 files pass** · `pricing:audit -- --check` (37 plans, all inside the
30–50% band) · production `build` succeeds · `npm audit --omit=dev` → 0
vulnerabilities. All internal `href`s resolve to a real page; no TODO/FIXME
stubs; every key in `.env.example` is read by code.
