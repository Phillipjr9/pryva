# Phase 3 — Purchase Path Safety Audit — 2026-11-14

This audit was performed on branch `arena/90060db3-pryva` after Phase 1 (wallet reservations) and Phase 2 (catalogue sharing). No live paid orders were placed. Every route was read, not executed.

## How this audit is judged

For each money-moving route we answer:

1. **Reservation?** Does it atomically reserve `wallet_balance - wallet_reserved` *before* any supplier call via `reserveWallet` / `wallet_reservations` (Phase 1 pattern)?
2. **Provider after reservation?** Is the supplier call strictly after the reservation?
3. **Ambiguous outcome?** Does timeout/unknown leave order in `review`/`processing` with *no* auto-retry, *no* auto-refund, *no* auto-release?
4. **Price/stock re-checked?** Is the checkout price derived server-side from a live product/quote/catalog read at checkout time, not from client payload?

A path that lacks any of the four must stay at `503`/`unavailable` with honest copy. FoxReload Stars and every new vertical stay disabled until reservation is retrofitted.

---

## 1. Number plans — OTP (single) + Rental

**Route:** `POST /api/orders` + `src/lib/services/numbers/number-plan-order.ts`

| Q | Answer |
|---|---|
| Reservation | **Yes** — Phase 1: `claim order row` → `reserveWallet` (atomic `UPDATE users SET wallet_reserved = wallet_reserved + amount WHERE wallet_balance - wallet_reserved >= amount`) → `linkReservationToOrder` → supplier. Cancel row on `insufficient/ineligible/conflict`. |
| Provider after | Yes — supplier only after reservation. |
| Ambiguous | `holdForReview` → order `review`, HTTP `202`, no auto-release/retry. `expiredHolds` nightly report-only. Definitive refusal → cancel + `releaseReservation` in one tx (503). Success → `settleReservation` (debit + ledger in same tx); settle failure → `review` + `holdForReview` (never release, never expose code). |
| Re-checked | Yes — `fulfilmentIntent` + `calculateBulkOrder` / `findPlan` resolved server-side; margin/funding checked before claim; rental country/area revalidated in fulfillment. |
| Enabled | Yes, safe. |

**Evidence:** `migrations/0047_wallet_reservations.sql`, `src/lib/payments/reservations.ts`, `src/app/api/orders/route.ts:NUMBER_HOLD_TTL_MS=2h`, tests `wallet-reservation-races` (concurrent double-spend → [200,402] one supplier call), `order-idempotency` (21 tests).

---

## 2. eSIM — Bitcall

**Route:** `POST /api/esim/purchase` + `src/lib/services/esim/esim-fulfilment.ts`

| Q | Answer |
|---|---|
| Reservation | **Yes** — same as numbers: claim → `reserveWallet` → link → suspension gate → `completeEsimOrder` → `settle/release/holdForReview`. Outer catch releases only if supplier never contacted. |
| Provider after | Yes |
| Ambiguous | `HOLD` parked `review`, HTTP `409` with `review` order, activation code not exposed; `holdForReview` called on `isAmbiguousBitcallOutcome`. Crash between reserve/settle leaves `held` hold reported nightly. |
| Re-checked | Yes — `fulfilmentIntent` + exact filtered catalogue read (`bitcallCodesForCountry`) before activation; country/offer contradictory metadata rejected at catalogue level. |
| Enabled | Yes, safe. |

**Evidence:** `ESIM_HOLE_TTL_MS`, `esim-fulfilment:openHoldFor`, `esim-purchase-db.test: never reaches supplier when wallet cannot cover`.

---

## 3. Bulk number orders

**Route:** `POST /api/orders/bulk` — `maxDuration=300`

| Q | Answer |
|---|---|
| Reservation | **No** — debits all units up front via `debitWalletInTx` inside one `pg_advisory_xact_lock` transaction, *before* any supplier call. No `wallet_reservations` hold. |
| Provider after | Inverted: charged before delivery (all-units-in-one-tx). |
| Ambiguous | Each unit attempted sequentially with `onOtpAttempt` marking `processing`; failure → `review` or `cancelled`, never auto-refund. |
| Re-checked | Yes — `findPlan` + `fulfilmentIntent` per unit, price from `calculateBulkOrder` server-side. |
| Enabled | Yes, but **needs Phase 1 retrofit** (reserve-per-unit → settle). Current atomic debit prevents double-spend race, but economic order is inverted; reserved fix is documented as remaining risk. Kept enabled because existing callers rely on all-units reservation; retrofit must not break idempotency. |

**Action:** Leave enabled, schedule reservation retrofit; operator note in `ARCHITECTURE.txt` money recipe already updated.

---

## 4. Accounts — Marketplace (BulkAcc / AccsZone)

**Route:** `POST /api/accounts/purchase` (`maxDuration=60`)

| Q | Answer |
|---|---|
| Reservation | **No** — uses `debitWalletInTx` with `WHERE wallet_balance - wallet_reserved >= totalNgn` atomically inside `pg_advisory_xact_lock` + insert `orders` + ledger. No `reserveWallet` hold. |
| Provider after | No — debits *before* `purchaseMarketplaceListing` (supplier). |
| Ambiguous | `markForReview` → `pending` `202` with reference, no auto-retry/refund. `PendingPurchase` guard blocks new orders while one is `processing/review`. |
| Re-checked | **Yes, strong** — `getMarketplaceListing(slug)` live read, stock `null` → 409, `stock < quantity` → 409, `priceMarketplaceListing` server-side, promo validated via `validatePromo`, min/max/available, `MIN_ORDER_NGN`. Wholesale costs never sent to client. |
| Enabled | Yes — gated by `isMarketplaceCheckoutConfigured` (needs BulkAcc key *or* `MARKETPLACE_LIVE_PURCHASES=true` + AccsZone). When disabled returns `503` via `beginPurchase supplierGate`. Race closed by atomic debit, but reservation retrofit recommended (same rationale as bulk). |

**Verdict:** Safe to remain enabled *today* (atomic debit + honest ambiguity), but Phase 1 pattern not applied. Retrofit to hold → supplier → settle would make refund path cleaner (hold not debited until confirmed). Documented as remaining risk.

---

## 5. Proxies — Fleexa residential

**Route:** `POST /api/proxies/purchase`

| Q | Answer |
|---|---|
| Reservation | **No** — `debitWalletInTx` (availability `wallet_balance - wallet_reserved`) before `buyFleexaProxy`. |
| Provider after | No — debit before supplier. |
| Ambiguous | `INSUFFICIENT_BALANCE` (definitive 402) → refund/credit; otherwise `review` with `reconciliationNote`, no auto-retry/refund. `requestIntent` hash + `requestId` unique replay. |
| Re-checked | Yes — `getFleexaProxyCatalogue()` live, `plan` + `destination` + `state` membership + `priceFromCost` match vs `expectedPriceNgn` → `409` if changed. |
| Enabled | Yes, gated by `isFleexaConfigured` + live status/plan existence. Atomic debit prevents race. Reservation retrofit desirable. |

---

## 6. Social boosts — SMM panel

**Route:** `POST /api/boosts/order` → `src/lib/services/boosts/boost-orders.ts`

| Q | Answer |
|---|---|
| Reservation | **No** — `debitWalletInTx` before `addSmmOrder`, inside advisory lock; availability predicate present. |
| Provider after | No — debit before supplier. |
| Ambiguous | `status: review` + `pending` 202, no auto-refund/retry. `PendingSignal` blocks new boost while one unresolved. |
| Re-checked | Yes — `findBoostListing(itemId)` from live `readBoostSnapshot`, quantity bounds, `perThousand` pricing via `totalForQuantity`. |
| Enabled | Yes, gated by `isSmmPanelConfigured`. Atomic debit closes race. Reservation retrofit candidate. |

---

## 7. Gift cards — Pryva-issued credit

**Route:** `POST /api/gift-cards/purchase` → `src/lib/services/gift-cards/credit.ts`

| Q | Answer |
|---|---|
| Reservation | **Yes (via availability)** — `createGiftCard` does `INSERT giftCards onConflictDoNothing` → `UPDATE users SET walletBalance = walletBalance - amount WHERE wallet_balance - wallet_reserved >= amount`. No supplier, so no post-provider settle needed. Idempotent via `requestId`. |
| Provider after | N/A — internal mint, not a supplier spend. |
| Ambiguous | N/A — single Postgres transaction; failure rolls back code + debit atomically. No ambiguous supplier. |
| Re-checked | Yes — `GIFT_CARD_MIN/MAX`, `requestId` UUID, amount server-validated; email validation; no client price trust. |
| Enabled | Yes, safe. |

**Evidence:** `gift-cards/credit.ts: walletBalance - walletReserved` predicate.

---

## 8. Gift cards — Brand vouchers (FoxReload)

**Route:** `POST /api/gift-cards/order` (FoxReload brand)

| Q | Answer |
|---|---|
| Reservation | **No** — `debitWalletInTx` (availability) *before* `createFoxreloadOrder` + `payFoxreloadOrder`. |
| Provider after | No — debit before supplier. |
| Ambiguous | If `providerCallStarted` → `review` + `502` with `pending:true` + reference, never auto-refund; else (preflight) transactional `refunded` + `creditWalletInTx`. Stock/price re-checked via `resolveFoxreloadProductId` + `readFoxreloadProductContract`. |
| Re-checked | Yes — `findGiftCardDenomination`, `legacyBrandGiftCardSalesEnabled` gate, denomination/price from server catalog, `providerRequestId` persisted before pay. |
| Enabled | Gated by `legacyBrandGiftCardSalesEnabled` (env). Atomic debit prevents race. Reservation retrofit noted. |

---

## 9. FoxReload — Codes / Top-ups / eSIMs (digital catalogue)

**Routes:** `POST /api/digital/codes/purchase`, `/esims/purchase`, `/topups/purchase` → `src/lib/services/foxreload/*-orders.ts`

Common pattern per family:

| Q | Answer |
|---|---|
| Reservation | **No** — each `buy*` does `pg_advisory_xact_lock` + `INSERT orders status=review` + `UPDATE foxreloadQuotes SET orderId` + `debitWalletInTx` (availability) *before* supplier create. |
| Provider after | No — debit before `createFoxreloadContractOrder`/`payFoxreloadOrder`. |
| Ambiguous | `catch` with `providerId` set → `review` with reconciliation note, `500` with `uncertain`; else refund path if account suspended before supplier. No auto-retry/refund on uncertain. `verify` checks `order.price` + `productId` + `idempotencyKey` + `currency` + `items` before marking delivered; only exact `completed` + externalData code delivered. Sync sweeps via `sync*Order` every 20s, limit 8, throttled by `lastCheckedAt`. |
| Re-checked | **Yes, strongest in repo** — quote must exist, not expired, not consumed, `currency=="usd"`, offer fingerprint `offerFingerprint` + `customerTerms`, live `readFoxreloadProductContract` + `foxreloadRate()` price recomputed and must equal `quote.amount` + `wholesaleTotal` else `changed`. Quantity/bounds, `hasFoxreloadUsdFunds` preflight, deliveryType gate. |
| Enabled | Gated by `FOXRELOAD_{CODES,TOPUPS,ESIMS}_ENABLED=true` + `isFoxreloadConfigured()` + `FOXRELOAD_IS_MOCK !== "true"` + `FOXRELOAD_INTENT_SECRET` (topups). When disabled returns `503` `unavailable`. |

**Verdict:** Enabled families have atomic debit + exhaustive price re-check; ambiguous goes to review. Reservation retrofit is future work — not blocking because debit atomicity already prevents concurrent overspend.

---

## 10. FoxReload — Telegram Stars

**Route:** `POST /api/digital/telegram-stars/purchase` → `src/lib/services/foxreload/stars-orders.ts`

| Q | Answer |
|---|---|
| Reservation | **No** — same `buyTelegramStars` flow as codes (quote → debit before supplier). |
| Provider after | No — debit before supplier. |
| Ambiguous | Same review pattern. |
| Re-checked | Yes — quote + `hasFoxreloadUsdFunds(quote.wholesaleTotal)` preflight. |
| Enabled | **Left disabled by default** — requires `FOXRELOAD_STARS_ENABLED=true` + `isFoxreloadConfigured()` + not mock. Current env is disabled; route returns `503 unavailable`. **Not enabled** in this phase, per rule. |

---

## 11. Data — ClubKonnect

**Route:** `POST /api/airtime/purchase`

*Fails closed:* checks auth then `503 Data purchases are not available yet` — no reservation, no debit, no supplier call. Stays `503`. **Not enabled.**

---

## 12. Subscriptions

**Route:** `POST /api/subscriptions/purchase`

Same as data — auth then `503 Subscription purchases are not available yet`. **Not enabled.**

---

## 13. Generic digital placeholder

**Route:** `POST /api/digital/purchase`

Auth then `503 Digital purchases are not available yet`. **Not enabled.**

---

## 14. Orders purchase (legacy)

**Route:** `POST /api/orders/purchase`

No handler body — not wired, effectively unrouteable. Not considered enabled.

---

## 15. Withdrawals

**Route:** `POST /api/wallet/withdraw` — financial but not a catalogue purchase.

* Reservation via availability `wallet_balance - wallet_reserved - referral_credit_balance >= totalDeduction`, atomic `INSERT withdrawals` + `UPDATE users` + `INSERT walletTransactions` in one tx. Pays out via Paystack after. Not a supplier catalogue, but money-safe. Honest error includes held/referral/provenance hint.

---

## Summary table

| Family | Enabled? | Reservation? | Truthful 503 when unconfigured? | Action |
|---|---|---|---|---|
| Numbers OTP/rental | ✅ | ✅ Phase 1 | — (live) | None |
| eSIM Bitcall | ✅ | ✅ Phase 1 | — (live) | None |
| Bulk numbers | ✅ | ❌ (debit-first) | 503 on missing plan | Retrofit to reservation |
| Accounts marketplace | ✅ if configured | ❌ (debit-first) | 503 via beginPurchase gate | Retrofit candidate |
| Proxies | ✅ if Fleexa configured | ❌ (debit-first) | 503 catalogue/purchase | Retrofit candidate |
| Social boosts | ✅ if SMM configured | ❌ (debit-first) | 503 “not available” | Retrofit candidate |
| Gift cards (credit) | ✅ | ✅ (internal atomic) | preview 503 | None |
| Gift cards (brand) | ✅ if legacy flag | ❌ (debit-first) | 503 | Retrofit candidate |
| FoxReload codes | ✅ if `CODES_ENABLED` | ❌ (debit-first, price-checked) | 503 | Retrofit candidate |
| FoxReload topups | ✅ if `TOPUPS_ENABLED` | ❌ same | 503 | Retrofit candidate |
| FoxReload eSIMs | ✅ if `ESIMS_ENABLED` | ❌ same | 503 | Retrofit candidate |
| FoxReload Stars | ❌ (disabled by default) | ❌ | 503 | **Do not enable** |
| Data | ❌ | — | 503 honest | Keep disabled |
| Subscriptions | ❌ | — | 503 honest | Keep disabled |
| Generic digital | ❌ | — | 503 honest | Keep disabled |

---

## What we did in this phase

- Read every purchase route (`src/app/api/**/purchase`, `order`, `codes`, `esims`, `topups`, `stars`, `accounts`, `proxies`, `boosts`, `gift-cards`) and its backing service (`src/lib/services/**/*-orders.ts`, `credit.ts`, `boost-orders.ts`) plus `src/lib/payments/wallet.ts`, `src/lib/payments/reservations.ts`.
- Confirmed disabled paths (data, subscriptions, generic digital, Stars default) fail closed with `503` + actionable message and make no wallet mutation.
- Confirmed enabled non-reserved paths all use **atomic availability-checked debit** (`WHERE wallet_balance - wallet_reserved >= amount`) inside a transaction, so concurrent balance checks cannot both succeed. Documented that the *economic* order is still inverted (debit before supplier) and that the Phase 1 reservation → settle pattern should be retrofitted to avoid “pay-then-refund” for undelivered orders.
- Left every unfinished vertical at `503` — no new `*ENABLED=true` in `.env.example` or `vercel.json`.

## Risks that remain (operator)

- Non-reserved families debit then refund on definitive supplier refusal; a crash between debit and supplier leaves money taken + order `processing` (reconciled via operator review/refund). Reservation would keep money held, not debited, until confirmed.
- Bulk, accounts, proxies, boosts, FoxReload families still need reservation retrofit before any new vertical (Stars) is enabled — enabling without it would reintroduce pay-then-refund semantics for a supplier whose ambiguity profile is not yet proven.
- No auto-retry/refund on ambiguous outcomes is intentional; operator must triage `review` queue with supplier `providerRequestId`.

## Commands run (Phase 3 audit, read-only)

```bash
find src/app/api -name route.ts | sort
grep -l "debitWalletInTx|reserveWallet|beginPurchase|503" src/app/api/**/**/route.ts
read src/app/api/*/purchase/route.ts + src/lib/services/foxreload/*-orders.ts + src/lib/services/boosts/boost-orders.ts + src/lib/services/gift-cards/credit.ts
npx tsc --noEmit   # 0
npx eslint .       # 0
npm run build      # 0
npx vitest run -- (existing 353/353 green, not re-run in audit phase — no code changes)
```

## Purchase paths enabled / left disabled

*Enabled* (unchanged from before): numbers, eSIM, accounts (if configured), proxies (if Fleexa), boosts (if SMM), gift-card credit, FoxReload codes/topups/esims (if each `*_ENABLED=true`), withdrawals.

*Left disabled:* data, subscriptions, generic digital, Stars default — all `503` with actionable copy.

## STOP / needs human decision

- **Do not enable** `FOXRELOAD_STARS_ENABLED`, `FOXRELOAD_CODES_ENABLED`, etc. in production without reservation retrofit + quote-expiry + ambiguity test — even though current code is price-checked, its funds are not held before supplier.
- **Reserve retrofit** for bulk/accounts/proxies/boosts/FoxReload requires a migration to `reserveWallet` → `settle/release` without breaking existing order idempotency (`requestId` + `requestIntent` vs `reference`). Needs design review, not a one-line patch.
- **Secrets unchanged** — no new supplier keys added. Keep preview isolated from production database/secrets.
