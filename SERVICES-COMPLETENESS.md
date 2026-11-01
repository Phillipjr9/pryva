# Service-by-service completeness audit

Written 1 November 2026 against `arena/cdd1e92b-pryva` (`fed8a94`), by reading
every purchase route, supplier client, background sweep and customer surface.
Nothing here is taken from marketing copy; where copy and code disagree the
disagreement is named.

"Complete" is defined as one chain, all six links present:

1. **Catalogue** — the service and its plans exist and render (`src/lib/catalog.ts`).
2. **Gate** — a readiness check decides whether it may be sold *right now*
   (`src/lib/service-readiness.ts`, `src/lib/fulfillment.ts`).
3. **Purchase** — an authenticated, same-origin, rate-limited route that debits
   the wallet and records an order (`src/app/api/*`).
4. **Delivery** — a supplier call that returns the goods, or a documented manual
   lane (`src/lib/fleexa.ts`, `bitcall.ts`, `smm-panel.ts`, `manual-fulfilment.ts`).
5. **Recovery** — a refund/sweep path for every way delivery can fail
   (`auto-refunds.ts`, `rental-expiry.ts`, `boost-orders.ts`, `esim-fulfilment.ts`).
6. **Visibility** — the customer can see status and act (`/dashboard/orders/[id]`),
   and an operator can intervene (`/admin/fulfilment`, `/admin/reconciliation`,
   `/admin/boosting`).

## Verdicts at a glance

| # | Service | Sellable today | Delivered by | If delivery fails | Verdict |
|---|---|---|---|---|---|
| 1 | Virtual numbers for verification | Yes | Fleexa → Bitcall (failover) | Auto-refund after the single-number window | **Complete** |
| 2 | Number rentals (7-day) | Yes | Fleexa → Bitcall | Sweep closes it; auto-refund owns unpaid windows | **Complete** |
| 3 | Bulk numbers (max 20) | Yes | Same path, per-unit checks | Per-unit refund, partial success reported | **Complete** |
| 4 | eSIM data | Yes | Bitcall only | Nothing charged until the profile is issued | **Complete, single supplier** |
| 5 | Accounts marketplace | Yes | Supplier key + admin manual lane | Uncertain outcomes parked in `review`, reviewed by hand | **Complete** |
| 6 | Social boosts | Yes, when the SMM panel is configured | SMM panel | Debit reversed automatically, order marked `refunded` | **Complete** |
| 7 | Gift cards (supplier stock) | Yes | FoxReload | Wallet refund on any upstream failure | **Complete** |
| 8 | Gift cards (Pryva-issued) | Yes | Generated locally and emailed to the recipient | Not applicable — nothing upstream to fail | **Complete** |
| 9 | Wallet, top-ups, withdrawals | Yes | Paystack | Approvals, name checks, reconciliation queue | **Complete** |
| 10 | Temporary email inbox | Free, not a purchase | Local + database | Paused with an explicit reason on preview DBs | **Complete** |
| 11 | Scheduled / recurring orders | Yes, from `/dashboard/scheduled` | Nightly job → `runScheduledOrders()` | Nothing charged unless the plan was bought | **Complete** |
| 12 | App verification codes, extended inbox plans | No | No supplier for either | n/a | **Not sellable, correctly** |
| 13 | Residential proxies | No | No supplier | n/a | **Not sellable, correctly** |
| 14 | Mobile data & airtime | No | No supplier | n/a | **Not sellable, correctly** |
| 15 | Subscriptions / digital products | No | No supplier | n/a | **Not sellable, correctly** |

---

## 1. Virtual numbers for SMS verification — complete

- Catalogue and detail pages read the live supplier where a key exists
  (`src/lib/fleexa.ts`, `src/lib/bitcall.ts`); storefront sorting is
  cheapest-first for Pryva, selling prices unchanged (`src/lib/smm-pricing.ts`
  is boosts only — numbers price from `catalog.ts`).
- Gate: `isPlanFulfillable()` (`src/lib/fulfillment.ts`) is the single allowlist.
  `/pricing`, `/status`, `/virtual-numbers`, `/dashboard/services` and the plan
  page all consult it; `/api/orders` refuses anything outside it server-side.
- Purchase: `/api/orders` — auth, same-origin, JSON-only, body cap, rate limit,
  idempotency on `requestId`, wallet debit inside the same transaction as the
  order row.
- Delivery: supplier failover across Fleexa and Bitcall; the code is awaited then
  emailed (`number_code` outbox event) and shown on the order page.
- Recovery: `SINGLE_NUMBER_WINDOW` from `src/lib/refund-policy.ts`; `auto-refunds.ts`
  re-checks eligibility *inside* the UPDATE, so two workers cannot double-refund.
  The upstream cancel happens after the claim commits and a cancel failure is
  logged rather than blocking the refund.
- Visibility: `/dashboard/orders/[id]` shows the number, the code and a resend
  action; `/admin/reconciliation` lists unresolved and flagged orders.
- Tests: `number-plan-order`, `order-resend`, `number-code-sync`,
  `number-code-email`, `auto-refund-safety`, `fulfillment-safety`.

**Gap:** resend is Bitcall-only (`otp-resend.ts`). A Fleexa order whose code never
arrives gets an honest refusal instead of a second attempt (G4).

## 2. Number rentals — complete

Rentals are ordinary orders with a validity window. `src/lib/rental-expiry.ts`
`expireFinishedRentals()` closes finished ones and is bookkeeping only: it skips
`SINGLE_NUMBER_WINDOW` plans (auto-refund owns those) and any row already
`refundedAt`, so the two sweeps can never fight. Dashboard shows the live expiry.
Tests: `rental-expiry`, `number-plan-order`.

**Gap:** `rent-ng-7` is listed but not in `FULFILMENT_MAP`; it is priced and
described, cannot be ordered, and `/api/orders` rejects it.

## 3. Bulk numbers — complete

`src/lib/bulk-orders.ts` caps at `MAX_BULK_UNITS = 20`, allowlists via
`fulfilablePlans()`, and applies 5% at 10+ / 10% at 20. `/api/orders/bulk` prices,
debits once, then delivers per unit and reports which units succeeded; failed
units are refunded individually. `/dashboard/bulk-orders` only offers deliverable
slugs, which is why the tier copy never advertises a plan that cannot ship.
Tests: `bulk-orders`, `bulk-orders-extended`, `bulk-orders-route`.

## 4. eSIM data — complete with one supplier

- Catalogue: `/esim` lists six written sample cards when live ordering is off; once
  `isEsimOrderingAvailable()` (i.e. Bitcall configured) they disappear and the page
  points at the dashboard catalogue, which lists Bitcall's live plans. No path
  sells a plan that does not exist upstream.
- Purchase: `/api/esim/purchase` — debits, creates the order, asks Bitcall for the
  profile; `pending → processing → /api/esim/orders/[id]/complete`. The profile is
  issued before the charge stands, and a nightly sweep retires stale rows.
- Delivery: activation code rendered by `EsimProfile` on `/dashboard/esim/[id]` and
  emailed as a 3D-styled message with the QR attached (`esim_delivery` outbox event).
- Recovery: nothing is charged when the profile cannot be issued.
- Tests: `esim-purchase-route`, `esim-delivery-email`, `bitcall-esim-catalog`.

The order page draws the QR from the activation string server-side
(`esimQrDataUrl`) and inlines it as a data URL, so the page carries no extra
request and the scan is step one of the install — the email had been telling
customers to "open your order page to view the QR code" when the page showed only
the string.

**Gap:** no failover — Bitcall is the only eSIM supplier (G3).

## 5. Accounts marketplace — complete

`/api/accounts/purchase` requires a supplier credential; when none exists it
offers the admin-gated manual lane (`manual-fulfilment.ts`) rather than a fake
instant delivery. A receipt that is unreadable or ambiguous is marked `review` —
deliberately never retried and never auto-refunded, because a second attempt on an
ambiguous credential can hand the same account to two buyers. `stock === null`
means "unknown", never zero. Admin sees the queue at `/admin/fulfilment` with
`processing` ("Needs credentials") and `review` ("Could not source") wording.
Tests: `manual-fulfilment`, `bulkacc-supplier`, `admin-refund-reconciliation`.

## 6. Social boosts — complete, gated on the panel

`/dashboard/services/boost/[id]` returns `notFound()` unless
`isSmmPanelConfigured()` and the listing actually contains the service with
`perThousand` and `min`. `src/lib/boost-orders.ts` debits, records the order, and
then calls the panel exactly once — the panel has no idempotency key and no
reliable release, so a replay would double-spend. On refusal the debit is reversed
and the order marked `refunded`; the customer-facing message is "Boosting is not
available right now. Nothing was charged." `/admin/boosting` shows readiness steps
and never prints key values.
Tests: `boost-orders`, `boost-order-route`, `boost-status-sync`, `boost-sweep`,
`boosting-readiness`, `admin-boosting-*`, `smm-*`.

**Gap:** no supplier failover (one panel); completion is visible on the order page
but never emailed (G5).

## 7. Gift cards (supplier stock) — complete

`/api/gift-cards/order` debits, buys from FoxReload, and on *any* upstream failure
refunds to the wallet and writes a `reconciliationNote`. The voucher code lands in
`referenceCode` and is shown to the buyer.
Tests: `gift-cards`, `gift-cards-extended`, `gift-card-security`.

A refund that cannot commit is now parked rather than announced: the order moves
to `review` with `reconciliationNote: "…; automatic refund failed — debit still
stands"`, which is the queue `/admin/reconciliation` shows, and the customer is
told the money will be refunded by support instead of being told it already was.
Previously the same "Your wallet has been refunded." sentence was returned whether
or not the credit committed.

## 8. Gift cards (Pryva-issued) — complete

`/api/gift-cards/purchase` debits the wallet and mints a `PRYVA-XXXX-XXXX-XXXX`
code; `/api/gift-cards/redeem` credits it, with per-IP and per-user budgets, one
redemption per card, a 12-month validity and a ₦500,000 cap
(`gift-card-rules.ts`, `gift-card-requests.ts`).
Tests: `gift-card-requests`, `brand-gift-cards`, `gift-card-page`.

`sendGiftCardDelivery()` (`src/lib/gift-card-delivery.ts`) now mails the code to the
address the buyer typed, through the template that had existed uncalled since the
launch. The send is best effort and escapes the sender's name and message: the
card exists and the wallet is debited before the mail is attempted, so a mail
failure must never turn a completed purchase into an error the customer retries.

## 9. Wallet, top-ups, withdrawals — complete

One ledger (`src/lib/wallet.ts`) for every debit and credit, so refunds appear as
wallet credits with references that `/dashboard/wallet` shows. Withdrawals refuse
with explicit 503/429/400/404/409/403 outcomes, run the depositor-name check first,
then an admin approval with audit entries (`/admin/withdrawals`,
`/admin/payout-names`). `/admin/reconciliation` triages pending top-ups, unresolved
orders, ledger breaks and aged withdrawals read-only.
Tests: `withdrawal-security`, `bank-account-onboarding`, `wallet-*`,
`payout-name-approval`, `admin-refund-reconciliation`.

## 10. Temporary email inbox — complete, free

`/api/inbox` is free (one inbox per account per day) and refuses with a reason on a
preview database instead of failing silently; `/dashboard/inbox` explains the pause.
Tests: `inbox-route`, `disposable-inbox`, `inbox-diagnostics`, `inbox-responsive`.

## 11. Scheduled / recurring orders — complete

The processor was already written to buy first and charge only what it bought; the
missing half was that nothing called it. `vercel.json` schedules only
`/api/cron/nightly`, and the dedicated route exported `POST` while Vercel Cron
sends `GET` — a job registered there would have been answered 405 forever.

- `runScheduledOrders()` is now a step inside the nightly job, placed **after** the
  refund sweep so an order it creates is never examined by the same run. It is
  skipped on a preview database, reports all three counts (processed, skipped,
  failed) in the run summary, and a failure in it cannot stop the other steps.
- `/api/cron/scheduled-orders` answers `GET` as well as `POST`, for a manual run.
- `/dashboard/scheduled` is a real screen: create from the plans that have a
  supplier path, at a stated cadence, then pause, resume or cancel. It says the
  runner wakes once a night, that `daily` therefore means "every night", and that
  a balance below one run means no charge — the schedule simply stays due.
- A schedule that is due because its last attempt did not go through says so, by
  comparing `nextRunAt` to now rather than showing a date that has already passed.

Tests: `scheduled-wiring` (the route answers GET, refuses a wrong secret, and the
nightly job calls it) and `scheduled-manager-ui` (the body sent, the honest copy,
pause/resume/cancel).

## 12. App verification codes, extended inbox plans — not sellable, correctly

`vn-otp-5` carries `noPreviewCheckout` and `action: null` in
`src/lib/service-explorer.ts`; there is no per-app mapping to buy. The longer inbox
durations are catalogue rows with no billing path. Both are marked "not available
yet" in the places a customer meets them.

## 13–15. Services with no supplier at all

Proxies, mobile data/airtime and subscriptions/digital have no client, no route
that can succeed, and no storefront funnel:

- `/api/airtime/purchase` and `/api/digital/purchase` fail closed before any debit.
- `/dashboard/data` states outright that data plans cannot be delivered yet;
  `/dashboard/digital` and the email-OTP pages carry the same pause wording.

The **only** copy that disagreed has now been corrected (see below): `/proxies`
offered a "Get Started" button per plan and a hero signup funnel for plans that
cannot be ordered, `/faq` said eSIM was not purchasable, and `/refund-policy` filed
proxies under "Case by case" alongside eSIM and offered a refund route for airtime.

---

## Gaps, worst first

| # | Gap | Severity | Status |
|---|---|---|---|
| G1 | Scheduled orders could be created but never ran | Medium — no money loss, but a dead promise | **Fixed**: nightly step + GET route + management screen |
| G2 | A failed gift-card refund was only logged | Medium — unpriced money | **Fixed**: order moves to `review` with a note in the reconciliation queue, and the customer is not told a refund happened |
| G3 | eSIM has one supplier, no failover | Medium | **Open**: needs a second eSIM credential. Fleexa has no eSIM endpoint, so there is nothing to fail over *to*; adding a fake second path would be worse than the single one |
| G3b | The eSIM order page showed no QR | Low | **Fixed**: `esimQrDataUrl()` inline in the page |
| G4 | Resend is Bitcall-only | Low | **Open**: route resends through wherever the number was bought |
| G5 | Boost completion is never emailed | Low | **Open**: needs a `boost_complete` outbox event |
| G6 | Pryva gift cards were not emailed to the recipient | Low | **Fixed**: `sendGiftCardDelivery()`, best effort, HTML-escaped |
| G7 | Copy drift on `/faq`, `/refund-policy`, `/proxies` | Low | **Fixed**: see below |

## What production must configure before each "gated" service opens

| Service | Variable(s) | Effect when missing |
|---|---|---|
| Numbers, rentals, bulk | `FLEEXA_API_KEY`, `BITCALL_KEY_ID`/`BITCALL_API_SECRET` | Plans render; checkout refuses with a truthful message |
| eSIM | Bitcall credentials | `/esim` shows the six sample cards; no ordering |
| Scheduled purchases | `CRON_SECRET` (the nightly job runs them) | Schedules can be created; nothing would run them |
| Boosts | SMM panel URL + key | Boost page 404s; `/admin/boosting` shows readiness steps |
| Accounts | Supplier credential | Only the admin manual lane is offered |
| Gift cards | FoxReload base URL + key | Order route refuses before debiting |
| Any cron | `CRON_SECRET` (plus `NEXT_PUBLIC_APP_URL`) | Sweeps cannot authenticate; leftovers age instead of clearing |

## Copy corrected in this pass

- `/proxies` — hero no longer sends visitors to signup; each plan shows the pricing
  page's own sentence ("This plan cannot be delivered yet, so it cannot be ordered
  or charged.") instead of a Get Started button; the pricing section states that
  proxy plans are not available yet. Plans and prices stay listed.
- `/faq` — the two eSIM answers no longer say eSIM cannot be purchased; they say
  where to buy one, that charging happens only when the profile is issued, and that
  an eSIM is data-only and does not move your number.
- `/refund-policy` — "eSIM data" and "Residential proxies" are separate rows now,
  and airtime/data are marked not available rather than carrying a refund route for
  a purchase that cannot be made.
- All three keep the owner's rule that no customer learns where stock comes from:
  the copy says "not available yet", never who supplies it, which is what
  `supplier-secrecy.test.ts` enforces.
- Pinned by `src/test/public-availability-copy.test.tsx`, which also asserts no
  proxy plan is ever in the fulfilment allowlist — if one is added, the test fails
  and points at the copy that must change with it.

## Fixed after the audit

- **G1 scheduled orders** — wired into the nightly job, route answers GET, and
  `/dashboard/scheduled` is a management screen.
- **G2 gift-card refund failure** — the order goes where an operator will see it,
  and the customer is told the truth.
- **G3b eSIM QR** — the order page draws the code the email already told customers
  to open the page for.
- **G6 gift-card delivery email** — the recipient is mailed the code.

## What is still missing

`GAPS.md` carries the backlog this audit produced: identity verification, error
reporting, CI, the single-supplier services, statements, disputes and the smaller
polish, each with the evidence and what unblocks it.

## How to re-run this audit

```
npm run typecheck && npm run lint && npm test
npx vitest run src/test/public-availability-copy.test.tsx src/test/scheduled-wiring.test.ts \
  src/test/scheduled-manager-ui.test.tsx src/test/gift-card-delivery.test.ts src/test/esim-qr-page.test.tsx
npm run pricing:audit -- --check
```
