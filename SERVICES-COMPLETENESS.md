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
| 8 | Gift cards (Pryva-issued) | Yes | Generated locally | Not applicable — nothing upstream to fail | **Complete**, no delivery email |
| 9 | Wallet, top-ups, withdrawals | Yes | Paystack | Approvals, name checks, reconciliation queue | **Complete** |
| 10 | Temporary email inbox | Free, not a purchase | Local + database | Paused with an explicit reason on preview DBs | **Complete** |
| 11 | Scheduled / recurring orders | No UI, API live | Nothing — no job runs it | n/a | **Dormant** (see G1) |
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

**Gaps:** no failover — Bitcall is the only eSIM supplier (G3); the order page
never renders a QR, only the activation string (G3b).

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

**Gap:** if the refund itself fails, the route only `console.error`s — the money
is then neither delivered nor returned until someone notices (G2).

## 8. Gift cards (Pryva-issued) — complete, no email

`/api/gift-cards/purchase` debits the wallet and mints a `PRYVA-XXXX-XXXX-XXXX`
code; `/api/gift-cards/redeem` credits it, with per-IP and per-user budgets, one
redemption per card, a 12-month validity and a ₦500,000 cap
(`gift-card-rules.ts`, `gift-card-requests.ts`).
Tests: `gift-card-requests`, `brand-gift-cards`, `gift-card-page`.

**Gap:** `giftCardEmail()` exists in `src/lib/email-templates.ts` but nothing calls
it — the recipient is only reached if the buyer copies the code by hand (G6).

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

## 11. Scheduled / recurring orders — dormant

The schema, API (`/api/scheduled-orders`, GET/POST/pause/resume/cancel) and
processor (`/api/cron/scheduled-orders` → `processScheduledOrders`) all exist, and
`createScheduledOrder` refuses any plan without `fulfilmentIntent`. But:

- `vercel.json` schedules **only** `/api/cron/nightly`, and `cron-schedule.test.ts`
  documents why `scheduled-orders` is excluded — that route exports `POST` only,
  Vercel Cron sends `GET`, and the Hobby plan allows two jobs. So nothing ever
  runs a schedule on Vercel.
- `/dashboard/scheduled` says recurring orders are unavailable; no UI creates one.

Net effect: a caller hitting the API directly can store a schedule that will never
execute. It cannot be charged (no run means no debit), so this is wasted intent
rather than a money leak — but it is the one service where the backend and frontend
disagree (G1).

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

| # | Gap | Severity | Evidence | Suggested action |
|---|---|---|---|---|
| G1 | Scheduled orders can be created but never run | Medium — no money loss, but a dead promise | `vercel.json`, `cron-schedule.test.ts`, `src/lib/scheduled-orders.ts` | Either retire the API until a job slot exists, or convert `/api/cron/scheduled-orders` to `GET` + fold it into `nightly` and ship the UI |
| G2 | A failed gift-card refund is only logged | Medium — unpriced money | `src/app/api/gift-cards/order/route.ts` critical-refund path | Fall back to a reconciliation row the admin queue can claim |
| G3 | eSIM has one supplier, no failover | Medium | `src/lib/esim-fulfilment.ts` (Bitcall only) | Add a second eSIM supplier behind the same interface the numbers lane uses |
| G3b | The eSIM order page shows no QR | Low | `src/components/dashboard/EsimProfile.tsx` | Render the activation QR from the same string the email uses |
| G4 | Resend is Bitcall-only | Low | `src/lib/otp-resend.ts` | Route resends through whichever supplier issued the number |
| G5 | Boost completion is never emailed | Low | `wallet-email-outbox.ts` event kinds | Add a `boost_complete` event |
| G6 | Pryva gift cards are not emailed to the recipient | Low | `giftCardEmail()` unused | Wire it into the purchase route |
| G7 | Copy drift on `/faq`, `/refund-policy`, `/proxies` | Fixed in this pass | see below | — |

## What production must configure before each "gated" service opens

| Service | Variable(s) | Effect when missing |
|---|---|---|
| Numbers, rentals, bulk | `FLEEXA_API_KEY`, `BITCALL_KEY_ID`/`BITCALL_API_SECRET` | Plans render; checkout refuses with a truthful message |
| eSIM | Bitcall credentials | `/esim` shows the six sample cards; no ordering |
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

## How to re-run this audit

```
npm run typecheck && npm run lint && npm test
npx vitest run src/test/public-availability-copy.test.tsx
npm run pricing:audit -- --check
```
