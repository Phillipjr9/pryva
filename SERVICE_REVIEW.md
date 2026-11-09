# Service-by-service review

This review is in progress. Local tests and simulated provider responses do not establish live availability, delivery, or provider contract correctness. Do not place paid production orders as a test.

## Cross-service catalogue visibility — in progress

The owner says supplier accounts are not funded and is concerned about incomplete display. Empty balance is not by itself evidence that an API catalog is empty. Some supplier catalogue endpoints may refuse an unfunded account; this is not established for production. No paid tests were made.

- Local change: show identifiable social-promotion listings without a price or buy action when pricing inputs are unavailable. This avoids dropping the list when the balance call cannot supply a currency or an exchange rate is missing. Checkout still requires a verifiable price.
- Local change: remove the additional silent 2,000-entry truncation from social and Fleexa email/rental snapshots. Underlying adapters retain bounded responses; the social adapter still caps parsed raw rows at 5,000, and the eSIM adapter has a five-page cap. Other country, category and provider response limitations remain.
- The hub integrates live numbers/email, verification, eSIM and social feeds; accounts use their own marketplace page. Data and subscriptions do not currently expose verified live plans in the hub, and their dedicated pages say ordering is unavailable. They cannot be made complete by topping up alone without a supported catalogue/integration. Country selection, pagination and collapsed social groups also affect what is visible at once.
- The hub initially renders 12 cards, and social platform sections after the first are collapsed. Bitcall OTP uses country pools exclusively when any exist, and consults the service feed only when none do; whether the latter has additional country-specific offers requires supplier evidence. The eSIM explorer shows explicitly matched coverage or global plans with unconfirmed coverage, not every regional listing.
- A supplier key previously caused the customer readiness label to claim data, subscription and proxy checkout worked, despite those paths being paused. Local change: mark these paused regardless of key until delivery is connected.
- Production API responses and actual supplier catalogues have not been inspected; the code findings do not establish the cause or complete missing inventory in production. The signed-in `/api/services/catalog?country=ng&feed=...` responses report `live`, `reason`, `partial` and customer-safe item counts without placing orders; compare each of the four feeds in production to narrow the cause.
- Validation: 118 tests across eight catalogue, UI, boost checkout and diagnostics files passed; readiness, explorer, registry and coverage tests 54 passed. Typecheck, lint, build and diff check passed. Changes are local and undeployed.

## 1. Number plans — in progress

### Local changes

- Refresh the Bitcall quote before every single-number purchase, including generic country plans; do not spend against a stale catalogue after a failed refresh.
- Preserve an accepted OTP activation reference before post-purchase price conversion, and preserve a rental reference even when the provider's receipt lacks the phone number. Incomplete outcomes remain in review rather than being bought again.
- Consider later matching rental areas when earlier areas are unavailable, unpriced, or outside the configured margin floor.
- Do not mark a number delivered merely because the provider reports a delivered status without a code.
- Show the refund-request option only for single-number orders, including expired ones; explain that final provider confirmation and a matching debit are required.

### Open blockers

- Single-number and rental checkout currently checks the wallet before the provider call but debits it afterwards. Concurrent purchases with distinct request IDs can pass the same balance check and spend supplier funds before only some wallet debits succeed. The remaining accepted orders go to review. Design and test a durable wallet reservation/settlement and safe recovery for definitive failures and uncertain outcomes before considering this resolved; account for suspension, duplicate requests, crashes, bulk and scheduled purchases, and existing review orders.
- Provider endpoint contracts, live stock, prices, returned receipts, and delivery have not been verified in production. Do not enable unsupported bundles or durations by guessing provider parameters.
- Historical orders already marked delivered without a saved code and orders in review need evidence-based reconciliation; the changes above do not repair past records automatically.
- Refunds remain held when final provider status or an exact linked debit cannot be confirmed. The nightly scheduler and real multi-connection crash behavior require operational verification.

### Validation

- Number, fulfillment, idempotency, rental, OTP, refund, bulk and scheduled focused regression: 156 tests passed (12 files).
- Typecheck, lint, build and diff check passed locally. This is not a complete test-suite or live-provider verification.

## 2. eSIM — in progress

### Local changes

- Bind newly claimed request keys to service, offer, displayed price and plan-terms fingerprint. Check both normal replays and unique-index conflict winners. Legacy eSIM orders without fingerprints can only be checked against their service and offer; their historical terms cannot be verified.
- Persist the account- and offer-scoped request key and original confirmed terms in browser storage across reloads. Corrupt or inaccessible storage blocks buying rather than silently generating a replacement. When the displayed terms change, replay only: never start a new purchase at the old terms. Unknown, processing and review attempts retain their key; a documented supplier refusal permits a fresh attempt.
- The unpaid completion message now directs the customer to support instead of promising a top-up and retry flow that does not exist.

### Open blockers

- Checkout calls the paid provider before debiting the wallet, and pending provisioning has no reservation. Concurrent spending can produce an unpaid supplier profile, with the order sent to review. A durable cross-service reservation/settlement design must cover pending provisioning, definitive refusals, uncertainty, crashes, suspension and existing orders before this is resolved. Never automatically release funds for an uncertain paid-provider call.
- Browser storage does not guarantee a shared key across devices, private sessions, storage clearing, or simultaneous tabs racing to create an initial key. A server-side claim/attempt recovery design is still needed. Failed pre-claim attempts with changed terms can require support rather than a safe automatic reset; no operator reset flow is implemented here.
- Existing processing and review orders need evidence-based reconciliation; an unpaid review order cannot be resolved by the customer completion endpoint. Provider behavior, live availability, pending sweeps and refunds have not been verified against production.

### Validation

- eSIM checkout, database, completion, fulfillment, plan page, catalogue, QR and delivery-email tests: 88 passed (8 files).
- Typecheck, lint, build and diff check passed locally. No paid provider calls were made.

## 3. Data plans and 5. Subscriptions — in progress

### Findings and local changes

- Both plan APIs and both purchase APIs intentionally return unavailable; no data or subscription supplier implementation is connected. The static sample plans and prices are not verified provider offers.
- The empty category screens now link to their respective service-status pages and explicitly say no plans can be ordered. No fake offers or prices were added.
- Removed a data-service starting price and instant-delivery claims from the shared catalogue copy. Provider credentials alone no longer mark data, subscriptions, or proxies as configured in operator lane readiness.

### Open blockers

- The owner selected existing integrations but could not identify which suppliers support these products. FoxReload's public site advertises telecom top-ups and digital subscriptions, and its public API documentation describes catalogue and code fulfillment; that makes it a candidate for both, but it does not establish Nigerian network/data SKUs, availability in this account, subscription type/region, or top-up delivery fields. Bitcall's published gateway covers OTP, eSIM and HLR, not ordinary Nigerian data top-ups. Fleexa's primary site lists eSIM, numbers, inboxes and proxies; its marketing pages conflict on bill-payment support, so an API contract must be confirmed, not inferred.
- FoxReload public API documentation: https://foxreload.com/en/docs/api . Public supplier overview: https://foxreload.com/en . Bitcall overview: https://docs.bitcall.io/docs . Fleexa overview: https://fleexa.com.ng/ . No credentials should be shared in chat.
- The existing FoxReload parser substitutes a `code` delivery type and USD currency when fields are missing, defaults quantities/prices, and its search/list methods do not establish complete pagination or verified coverage. These defaults cannot be treated as evidence to enable subscription or data checkout. Read-only catalog, schema verification, account access and safe checkout/recovery must be implemented and tested before launch.
- Implement verified catalogue/availability, pricing and delivery only against the selected contracts, with shared durable wallet reservation, idempotent purchase claims, provider-status reconciliation and evidence-based failure/refund handling. Failed and ambiguous supplier calls must not be retried or refunded blindly.
- No live provider calls, paid orders, production changes or deployment were made.

### Validation

- 70 tests passed across service readiness, hub, catalogue, unavailable paths and admin coverage. Typecheck, lint, build and diff check passed locally.

## Remaining services — not yet reviewed in this pass

4. Accounts
6. App verification
7. Social promotion
8. Proxies
9. Email OTP
10. Gift cards
11. Bulk orders
12. Scheduled orders

## FoxReload read-only catalogue (local, not deployed)

A signed-in digital-catalog page now traverses FoxReload's documented whole-catalogue cursor endpoint, 50 items per request, and searches the supplier's separate search endpoint. Search has a 50-result supplier cap and the UI flags possible truncation; browsing follows cursors with previous/next controls. Supplier search and general access have shared rate budgets, individual requests are rate-limited, provider responses are bounded, and previews do not call the live supplier. Invalid provider pages and cursor loops fail closed. Only product names and hashed IDs are returned with cursor metadata; prices, stock, provider-only details and fulfillment fields remain server-side. Unreadable listings are flagged, not fabricated. Links are provided from the service hub, mobile data and subscriptions pages. This is not a verified catalog snapshot, category mapping, stock confirmation, retail price or checkout, and may include other supplier product types. The supplier account's actual catalogue and credentials have not been tested; a missing key or upstream error displays an unavailable message. There have been no live requests or orders in this pass.

New products cannot be ordered from this browser. Safe sale still requires confirmed provider/account coverage, retail pricing, distinct code/eSIM/direct-top-up/login-top-up/card fulfillment, confirmation-code handling, durable wallet reservations and idempotency/recovery, and provider reconciliation. FoxReload's docs disagree on webhooks/idempotency; do not treat either as proven. Existing gift-card/eSIM ordering paths were not generalized or represented as fixed.

Verification for this change: FoxReload client, route, UI, service explorer and destination page tests 34/34; typecheck, lint, diff check and production build passed. Full suite outcome is recorded separately if completed.

Full suite run after the catalogue implementation: 2,589/2,590 tests passed, with one stale service-selection UI test failing (an immediate assertion before the independently loaded verification feed completed, followed by outdated empty-data copy). Updated the assertions to await the feed and expect the current truthful message. The affected UI test and new catalogue tests then passed 20/20. The full suite has not been rerun since that test-only correction.

## FoxReload purchase integration groundwork (local, not deployed)

The user clarified that the goal is every missing FoxReload offering as a purchasable service, not just display. Added a separate strict provider contract/parser, avoiding the legacy gift-card mapper's price/currency/delivery defaults. It preserves wholesale decimal precision to four places, validates quantity and explicitly supplied note-field types/options, and can build a documented Telegram Stars order with `quantity` and `note.username`; a mocked-fetch test checks its request, including `isMock`. Added the documented confirmation-code request using order-item UUID and `clientCode`. Endpoint-specific supplier budgets apply to both legacy and new clients. Unknown metadata fails closed. Banking-card issuance and top-up are excluded from the generic item builder: issuance includes a separately priced initial amount and top-up requires card ownership isolation. This is an internal foundation, not an active customer checkout, quote, payment, order-status synchronization or reconciliation; no provider call was made in this pass. The new primitives must not be called for real orders without durable wallet claim/debit, confirmed server-side retail pricing and FX, strict intent-bound replay, payment validation, delivery-specific completion, and a recovery path for ambiguous provider outcomes. Provider mock examples and idempotency are not live-verified. Existing gift-card path has separate unsafe matching concerns and is not a template for this integration.

Verification: contract, provider client and legacy gift-card security/refund tests 30/30; typecheck, lint, diff check and production build passed (before the final test-only additions). Full suite not rerun this turn.

## Telegram Stars vertical slice (local, not deployed; disabled by default)

A Telegram Stars quote, purchase and status path is now implemented in the working tree. It reads the documented Stars item afresh, checks the explicit direct-top-up/username contract and stock/quantity and computes a whole-naira quote with exact decimal arithmetic, a manually configured `FOXRELOAD_USD_NGN_RATE` and 40% markup. Migration `0041` stores short-lived user-owned, one-use quotes, retaining consumed ones for reconciliation. Checkout binds a request ID to quote and username, rechecks terms, atomically claims the quote/order and debits the wallet, then creates one supplier order and verifies identity, quantity, price, currency, idempotency key and non-mock state before payment. The upstream idempotency key is the server-generated order UUID, not the customer's key. A provider ID is stored before payment. Ambiguous calls remain in review without automatic retry or refund; verified direct-top-up completion can be polled from the order page or a bounded fair nightly sweep. Browser storage retains the original attempt for recovery. A suspended/deleted account found before the supplier call has the debit atomically returned.

This is NOT production ready or all FoxReload services. `FOXRELOAD_STARS_ENABLED` defaults off and requires a current FX rate. No live provider/product/account access, mock order, paid test or deployment occurred. The OpenAPI and older documentation conflict about idempotency; the actual account contract must be verified. Some failures or process crashes can leave a charged order in review/processing and require evidence-based operator intervention; an interrupted processing claim has no audited automatic recovery. Tests use PGlite and mocked provider responses, not production concurrency. Other code, eSIM, direct and login top-ups, confirmation-code UX, card issuance/topups/ownership and reconciliation are still incomplete. The existing gift-card matcher remains unsafe to generalize. Do not enable Stars merely because the API key exists.

Final verification after updating all hard-coded migration fixtures: full test suite 262 files / 2,612 tests passed; typecheck, lint, production build and `git diff --check` passed. These are mocked/local checks and do not establish live supplier behavior or make the disabled checkout ready to enable.

## FoxReload public catalogue comparison (scope: all offerings)

This section supersedes the earlier statements that no public product catalogue was read. The public API was queried without credentials; the user account's catalogue, prices, stock, permissions, and ability to pay were **not** verified. A whole-catalogue listing reported 135,783 records, not 135,783 purchasable offers. The first page had null prices and zero stock, while search and product-detail responses included some nonzero prices and quantities in RUB. Supplier timestamps included dates later than the local review date, so they are reported as returned rather than treated as a reliable snapshot date. Root `inStockCount` values below are provider-reported aggregates and must not be summed or equated with account-accessible offers. We did not enumerate every SKU: the category-tree depth=3 call was too large, the games branch alone has hundreds of response chunks, and the XLSX download is outside the sandbox's allowed outbound hosts. The list below maps **all returned root categories**, not an exhaustive SKU-by-SKU difference report.

| FoxReload root category (slug; public inStockCount) | Examples and Pryva purchase coverage |
|---|---|
| `esim` (13,896) | Geographic/regional travel eSIMs, including Airalo. Pryva has a separate Bitcall eSIM purchase flow; FoxReload eSIM plans and fulfillment are not integrated, and no SKU equivalence has been established. The existing Bitcall path has a supplier-spend-before-wallet-debit race. |
| `rewarble` (23) | Rewarble service vouchers. No dedicated purchasing/fulfillment path identified. |
| `test-orders` (2) | Supplier test SKUs, not customer merchandise. No account-specific test verified. |
| `game-currency` (3,112) | Game currency codes, e.g. Arena Breakout and EA Sports FC points. Existing Roblox/Razer gift-card entries are not general game-currency fulfillment. Missing generic code purchase and redemption delivery. |
| `topups` (5,305) | Game/account and telecom top-ups: for example 8 Ball Pool, Ace Racer, Airtel, 9Mobile. Named Airtel and 9Mobile category aggregates were zero. Pryva has no general FoxReload direct or login top-up checkout. Data/airtime purchase endpoints fail closed; this is not evidence that those Nigerian products are available in this account. |
| `gaming-services` (5,553) | Nintendo, Battle.net, EA, Epic, PS Plus, Xbox Game Pass, Steam Wallet, Twitch. Pryva has Steam, PlayStation, Xbox and Razer gift-card entries, not the complete products, regions, denominations, services or login-topups in this category. Existing gift-card matching/recovery still needs work. |
| `games` (43,816) | Game keys and DLC, including Steam titles. No general game-key checkout or delivery. |
| `app-stores` (1,700) | Apple iTunes, Google Play, Huawei. Pryva has limited Apple and Google gift-card entries, not Huawei or the full region/denomination set. |
| `gift-cards` (6,714) | Broad retail, restaurant, travel and other vouchers, e.g. Adidas and Airbnb. Pryva's FoxReload brand-card path is limited to Steam, Apple, Google, PlayStation, Xbox, Roblox, Amazon and Razer, with static denominations and unsafe fallback matching. Pryva-issued wallet gift credit is a different product. |
| `subscriptions` (1,122) | Adobe, Discord, Netflix, Telegram and software/services. Pryva subscription purchase endpoint currently returns 503; Stars checkout is a separate gated local implementation, not Telegram Premium. |
| `prepaid-finance` (822) | AstroPay, Binance, prepaid products, virtual/service payment cards and cryptocurrency. No FoxReload card issuance, card funding, credential viewing, ownership, 3DS or transaction support. Products can involve regulated/payment/compliance obligations and need separate controls; do not sell them using the generic voucher flow. Public ChatGPT search returned `banking_card` and `banking_card_topup` offers, so a software/AI label does not imply ordinary subscription fulfillment. |

Source: https://public-api.foxreload.com/api/categories/tree?depth=1 and the corresponding `parentId=<slug>&depth=1` endpoints; product searches for Telegram, ChatGPT and Nigeria. A search for MTN returned no matches; that alone is not proof of absence. Names, inventory and classifications change. Public results have a mix of priced/in-stock and unpriced/out-of-stock entries; none establishes this user's supplier access or a valid retail price.

### Required end-to-end work still missing

1. Obtain an account-authenticated, cursor-complete inventory and map exact product/region/denomination/delivery to real existing purchase paths, not brand labels; account for changes and rate limits. Do not log credentials or publish wholesale/account details. Keep unverified/unavailable SKUs off checkout.
2. Implement a common fresh quote, exact wholesale-currency conversion, audited configuration, durable single-use claim, atomic wallet reservation, idempotency, and provider-order/payment reconciliation with safe recovery. RUB public prices cannot be treated as USD. The local Stars path accepts USD only and remains disabled; its live currency depends on the authenticated account and requested currency.
3. Complete customer delivery separately for codes/keys (secure owner-only display and recovery), eSIM installation data, direct top-ups and login top-ups (including action-required confirmation codes and safe credential handling); validate product-specific fields and region before charging.
4. Separately design card issuance and card top-up, including initial funding, account-bound ownership, sensitive card data/3DS handling and compliance; generic checkout deliberately rejects both card delivery types.
5. Fix the existing static gift-card matching and recovery as well as eSIM/number supplier-spend-before-debit races. Independently resolve interrupted processing claims and supplier/payment ambiguity before enabling.

The public one-Star detail returned name `Telegram Stars 1` with an empty `noteFieldTypes` object and required `username`. The local gated Stars implementation now accepts this exact documented SKU/name and infers a string only for that SKU and field, while rejecting conflicting metadata and currencies other than USD. This avoids rejecting that observed shape without weakening generic products. It does **not** establish the real authenticated contract or make Stars live. Tests cover the inference and rejections; no paid order was placed or deployment made.

## Reviewed digital-code checkout (local, disabled)

Added a separate customer quote/purchase/delivery path for individually approved, region-specific, non-financial FoxReload `code` SKUs. It can serve appropriate game keys, gift vouchers, and code-based subscriptions after each SKU and region are reviewed; it is not a blanket catalogue checkout. The environment allowlist is empty by default, and `FOXRELOAD_CODES_ENABLED=false`. A current manually configured USD/NGN rate is mandatory; no currencies are silently converted and no price falls back. The product identity, exact name, stock, currency, no-note code contract and price are rechecked before a short-lived quote can be atomically consumed with a wallet debit. A fingerprint binds the approved name, display region, and supplier country/region attributes to the quote; a fresh supplier response must match those pinned attributes. Customer retries use a durable request ID; create/pay is not repeated after an ambiguous call, and the supplier order ID is saved before payment.

On completed non-mock orders only, the status verifier requires the matching provider order, exact price, product, type, quantity and completed item; one nonempty code is saved to the authenticated owner's uncached order page. Missing/multi-part/unrecognized results remain in review. Customer-triggered and bounded nightly status checks continue even with new sales disabled. No supplier codes or wholesale details are returned by the purchase response. There are no automatic refunds/retries for uncertain supplier calls. A processing crash can still require audited manual reconciliation, and quote-attempt recovery in browser storage does not cover every device/storage-loss case.

The generic slice does not authorize unreviewed catalogue entries, financial products, login/direct top-ups, eSIM profiles, multi-part codes or card issuance. It does not fix the existing legacy brand-card resolver. No account-authenticated catalogue, live mock, paid order or deployment occurred. Focused tests cover checkout, identity/price/region/ownership checks, concurrency, ambiguous payment, delivery verification, sweep and browser recovery. See OPERATIONS.txt for rollout limits.

Validation for this slice: the full suite completed at 263 files / 2,622 tests before the final region-attribute hardening and the two new route/UI test files were added. After those changes, 34 focused tests passed across code checkout, API, UI, contract and Stars; typecheck, lint, production build and `git diff --check` passed. These tests use mocked supplier responses/PGlite and do not verify live purchasing.

## Reviewed direct-top-up checkout (local, disabled)

Added a second generalized but deliberately restricted customer purchase path for operator-reviewed FoxReload `direct_topup` products. It covers only approved fixed/variable quantity products with known non-secret string identifiers (for example player ID or username), exact account-specific product name/region/quantity bounds and USD price. It does not accept passwords or login-top-up delivery. Approved terms are fingerprinted in a short-lived quote; purchase rechecks the fresh product, price, stock, fields, region and bounds and atomically consumes the quote with wallet debit. The supplier order is verified before payment, including recipient details. A keyed intent binds retries and status checks to the user, quote and exact target without storing the raw target in the order or browser recovery record. The buyer re-enters the original recipient on recovery. The order page and bounded nightly sweep confirm completion only for a matching non-mock completed order/item and target. Unknown or ambiguous supplier outcomes stay in review with no automatic pay retry or refund.

`FOXRELOAD_TOPUPS_ENABLED` defaults off and the reviewed-offer list is empty. It requires the supplier key, a current USD/NGN rate and a stable high-entropy `FOXRELOAD_INTENT_SECRET`; secret rotation while orders remain open breaks automatic intent verification. Supplier note shape, SKU-specific recipient validation/prechecks, account availability and real payment have not been verified. Select/numeric/custom inputs, login top-ups and confirmation codes, FoxReload eSIM fulfillment, banking-card programs and many other SKUs are still missing. No production deployment or paid order occurred. See OPERATIONS.txt for rollout and recovery constraints.

Verification after this change: full local suite 268 files / 2,643 tests passed, plus typecheck, lint, production build and diff check. Supplier behavior is mocked; these checks do not establish account-specific live readiness.

## FoxReload service and game top-ups — further comparison

Additional unauthenticated public product searches confirm that the catalogue is not just Telegram: Mobile Legends and Free Fire include direct top-ups requiring `account_id` (some also `server_id`); Delta Force has both direct top-ups and separate redeemable-code products; Telegram Premium has username-based direct products; Discord Nitro, Honor of Kings, Steam Wallet, PUBG: New State, Valorant and Rewarble TikTok products include code-delivery offers. These examples are catalogue evidence, not proof of the user's account access or of every region/SKU being purchasable. The public responses returned RUB values in some cases, so those cannot be used as USD prices. Several other records were out of stock, and searches returning no matches are not exhaustive.

This exposed a real compatibility gap: the restricted direct-top-up flow did not allow `account_id`. It now does, and a test uses the real published Mobile Legends field shape while ensuring the observed RUB price is refused by the USD-only checkout. Product restrictions are now required as reviewed offer configuration, shown to the customer before payment and stored on the quote for the owner's order page. Migration 0042 adds the terms snapshot. An operator must verify detailed restrictions: a supplier's `WW`/Global label can still exclude specific countries. None of these examples has been added to the allowlist or verified/activated against the account. Product-specific checks and terms are not automatically derived from the entire live catalogue.

This is still NOT all FoxReload service top-ups: dynamic/unreviewed SKU onboarding, many typed or select fields, login-based top-ups and confirmation-code workflows, prepaid card-backed subscriptions, account-specific inventory/prices, reconciliation of uncertain operations, and live end-to-end fulfillment remain incomplete. No live orders or deployment occurred. Final verification for the expanded slice: 268 test files / 2,644 tests passed; typecheck, lint, production build and `git diff --check` passed locally.
