# Service audit — completeness, API wiring, and the order things are chosen in

Written after walking every service family against its route, its supplier
client and a running instance (`~/dashboard`, `/dashboard/services`,
`/dashboard/accounts`, `/dashboard/data`, `/dashboard/digital`,
`/dashboard/gift-cards`, `/dashboard/bulk-orders`, `/dashboard/scheduled`).
Every claim below is from code or from a probe, not from copy on a marketing
page.

## 1. What each service can actually do

`Ready` means a customer can pay and receive the thing. `Catalogue` means the
listings render and nothing can be bought. `No path` means there is no supplier
integration at all.

| Service | Where it is | Route / supplier | Before this pass | Now |
| --- | --- | --- | --- | --- |
| Number plans | hub → plan page → checkout | `POST /api/orders`, fulfilment allowlist, **two suppliers with failover** (`src/lib/otp-suppliers.ts`) | Ready with a Fleexa key | Ready with either key: every configured supplier is priced, the **cheapest that clears the margin floor** is bought, and the listing is ordered cheapest-to-serve first |
| Social promotion | hub → boost page | `POST /api/boosts/order`, boosting panel | Ready with a panel key | Ready (unchanged) |
| Digital accounts | `/dashboard/accounts` | `/api/accounts/*`, accounts marketplace, manual lane | Ready with a marketplace key | Ready (unchanged) |
| Gift cards | `/dashboard/gift-cards` | `/api/gift-cards/order` (supplier) and `/api/gift-cards/purchase` (wallet credit) | Ready | Ready (unchanged) |
| Temporary inbox | `/dashboard/inbox` | `/api/inbox` | Works on a persistent database; `reason: "preview"` otherwise | Unchanged, now labelled |
| **Bulk orders** | `/dashboard/bulk-orders` | `POST /api/orders/bulk` | **Broken: charged the wallet, wrote each unit as `delivered`, never bought it** | **Ready with a Fleexa key: buys every unit first, then records and charges** |
| **Scheduled orders** | API + cron; page says not launched | `/api/scheduled-orders`, cron | **Broken: each run debited the wallet and wrote a `delivered` order without fulfilment** | **Fulfils before charging; refuses plans with no supplier path; skipped runs cost nothing** |
| **eSIM** | hub → `/dashboard/esim/[id]` | Live supplier catalogue, wallet checkout, activation code on the order | Catalogue only | **Ready to buy with an eSIM key: live plans, naira prices, profile delivered and recoverable** |
| App verification | hub | Both number suppliers, read-only listing | Catalogue only | Catalogue only — labelled |
| eSIM delivery email | inbox + order page | `wallet_email_outbox` (migration `0028`), Resend, QR attached as PNG | The profile existed only behind a login | **A delivered eSIM emails its instructions, activation code and QR; one email per order, queued in the same transaction as the profile** |
| Resend a code | order page → "Resend code" | `POST /api/orders/[id]/resend`, supplier resend, 2/min per order | No way to ask again: a code that never arrived ended in a refund | **One click re-delivers from the same rental; a supplier cooldown is reported as "wait a minute", never as success** |
| Number code sweep | nightly cron (`number-codes`) | Supplier read per open single-number order | Code arrived only while the order page was open | **Delivers codes for orders nobody is watching, before the refund sweep runs** |
| Supplier status | `/api/admin/suppliers` (admin GET) | Read-only catalogue probe, no buy call | No such check | **Per supplier per country: configured, listed, priced, in stock, cheapest naira cost, error code; plus per plan: our price, cheapest cost in naira, profit and margin against the floor** |
| Email OTP (paid) | hub, inbox | Fleexa email products | Catalogue only | Catalogue only — labelled |
| Proxies | hub + `/proxies` | none | No path | No path — labelled |
| Mobile data | `/dashboard/data` | `/api/airtime/plans` reads; `POST /api/airtime/purchase` always `503`; no supplier client | No path | No path — labelled |
| Subscriptions | `/dashboard/digital` | `POST /api/digital/purchase` always `503`; no supplier client | No path | No path — labelled |
| Airtime top-up | none | plans library only | No path, no screen | No path — recorded here |

## 2. The two services that took money without delivering

Both live in **Order tools**, and both were reachable enough to matter.

### Bulk orders

`POST /api/orders/bulk` debited the wallet, inserted one order per unit with
`status: "delivered"`, `provider: "manual"` — and stopped there. No supplier
call, no reference code, and no row in the hand-fulfilment queue, because that
queue only lists `processing`/`review`. A customer could pay ₦13,400 for ten
numbers and receive ten rows that said "delivered" and nothing else.

The route now:

1. refuses any line whose plan is outside the fulfilment allowlist
   (`isPlanFulfillable`), naming it — e.g. proxy plans, which have no supplier;
2. caps a basket at **20 units**, because each unit is an upstream purchase and
   a single request has to finish;
3. buys every unit with the same `fulfillPlan` the single-order checkout uses;
4. releases what it already bought (`cancelUpstream`) if any unit is refused or
   the database write later fails, and charges nothing;
5. records the orders as `active` with the supplier's own request id, code and
   expiry, then debits the wallet **once** for the basket.

The page now lists only deliverable plans and its copy no longer says bulk
purchasing is unavailable, because it is available.

### Scheduled orders

`processScheduledOrder()` did the same thing on a timer: debit, insert a
`delivered` order with provider `scheduled`, no fulfilment. The page correctly
says scheduled purchasing is not launched, but the API and the cron were live,
so a schedule created through the API would have charged every period for
nothing.

It now re-reads the row (due, still active), checks the balance, buys the plan,
and only then records and charges inside one transaction. A supplier failure
leaves the money alone, logs the reason, and leaves the row active for the next
run; a failed write releases the purchase. `createScheduledOrder` refuses a plan
with no supplier path. The feature still has no management screen, so it remains
unlaunched — but it can no longer take money for nothing.

## 3. Why the rest are not "just wired up"

There is no supplier key in this checkout, and three families have no supplier
client at all. Enabling checkout for any of them would take a customer's money
and deliver nothing — the failure the two fixes above exist to prevent. What
each one actually needs:

| Service | Blocker | Who can clear it |
| --- | --- | --- |
| eSIM | Nothing — pricing is now decided (their figure is cost, marked up in band, USD at `USD_NGN_RATE`) and checkout is wired. What remains is a live key and one small purchase to confirm the pricing assumption. | Owner: set `BITCALL_KEY_ID`/`BITCALL_API_SECRET`, buy one cheap plan, compare what the balance fell by. |
| App verification | The supplier publishes service codes (WhatsApp, Telegram, …) and the shop sells country plans. A per-app mapping has not been verified. | Owner + one staging purchase. |
| Email OTP (paid) | Supplier email products expose no duration, so a 24-hour inbox and a 30-day inbox are indistinguishable at purchase time. | Owner: pick products with a stated duration. |
| Proxies | No supplier client in the repository. | Owner: choose a supplier. |
| Mobile data | Prices and plans exist; no provider client, and `POST /api/airtime/purchase` is a deliberate `503`. | Owner: choose a supplier, then wire it like Fleexa. |
| Subscriptions | No supplier client; `POST /api/digital/purchase` is a deliberate `503`. | Owner: choose a supplier. |

## 4. The order services are offered in

The catalogue's category order was fixed and did not describe anything: app
verification (never orderable) came first, and a service that can be bought sat
below one that cannot. Three changes:

1. **A single verdict per family.** `src/lib/service-readiness.ts` derives one of
   five states — ready to buy, catalogue only, free tool, ordering paused, not
   connected — from the same configuration the checkout reads.
   `src/lib/service-states.ts` holds the client-safe wording, order and colours,
   so the browser never imports a configuration check.
2. **Ordered by what can be done.** The hub's category chips and the dashboard's
   "Select a service" tiles are sorted by that verdict — ready to buy, free tool,
   ordering paused, catalogue only, not connected — with ties keeping the
   catalogue's own order, each carries a coloured dot and an accessible label, and the hub
   states the tally: *"This deployment: 3 ready to buy · 4 catalogue only · 2 not
   connected."*
3. **A next step instead of a dead end.** Selecting a category that cannot be
   ordered now shows why, in one sentence, and an **Ask about it** link that
   opens support with the question already drafted (`#ask=…` in the URL fragment, capped at 200
   characters, never auto-sent). The same link pattern is used from any future
   surface that needs it.

The marketing "Get started" buttons were checked too: every one goes to
`/signup?plan=<slug>`, and `planDestination` only forwards a visitor to a plan
page when `canPreviewPlan` accepts it — everything else lands on the hub, which
now says what that category can do. None of those buttons promises a delivery
the checkout would refuse.

The constant `EXPLORER_CATEGORIES` is unchanged, so every existing link
(`?category=…`), sitemap entry and test still resolves; only the display order is
derived.

## 5. Verification

- `npm test` — 1,599 tests / 171 files, including new coverage for the bulk
  checkout's order of operations (fulfil → record → charge, release on failure),
  the scheduled run's refusal to charge without delivery, and the hub's
  readiness ordering and request link.
- `npm run typecheck`, `npm run lint`, `npm run build`.
- eSIM: `esim-catalog.test.ts` (pricing band, unsupported currency, coverage,
  hidden plan references) and `esim-purchase-route.test.ts` (replay, refusal,
  provisioning, delivery, unknown outcome).
- Probes against a running instance: `/api/airtime/plans` `200`,
  `/api/accounts/listings` `200` (`configured:false`),
  `/api/gift-cards/catalog` `200`, `POST /api/airtime/purchase` `503`,
  `POST /api/digital/purchase` `503`, and the live catalog `404` in preview.
- Every internal link reachable from the dashboard was crawled: 61 pages, no
  non-2xx.

**Not verified:** any supplier sandbox. The bulk and scheduled paths are tested
against a mocked `fulfillPlan`; the first real basket should be placed in
staging with a small quantity.
