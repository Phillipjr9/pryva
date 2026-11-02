# Enabling data, subscriptions and proxies (FoxReload)

_Last verified: 2 November 2026._

Three catalogue families used to be browse-only: their plans and prices were
written down, but there was no supplier behind them and both purchase routes
were permanent 503s. Proxies had no purchase route at all. They now share one
**fail-closed, config-driven** path through FoxReload, which Pryva already uses
and tests for gift-card vouchers.

**Nothing is sellable by default.** Every family stays "Not connected" until a
human supplies a real product ID from the FoxReload catalogue and completes a
staging purchase. There is deliberately no name-based search or "close enough"
matching: a wrong match would deliver the wrong goods for real money.

> **The repository is public.** Real product IDs must never be committed. The
> shipped `data/product-mappings.json` is only an empty template. Production sets
> `PRODUCT_MAPPINGS_JSON` (inline JSON, server-side); self-hosting can instead
> point `PRODUCT_MAPPINGS_FILE` at a file outside the checkout. The owner rule
> that no customer learns where stock comes from also means the customer-facing
> 503 is deliberately neutral — the detailed "what's missing" list lives only in
> the operator-only diagnostics endpoint. `supplier-secrecy.test.ts` enforces
> this in user-facing files and client bundles.

## What was wired

| Family | Pryva plans | Purchase route | Storefront |
|---|---|---|---|
| Mobile data | 32 `dataPlans` (`src/lib/airtime.ts`) | `POST /api/airtime/purchase` | `/dashboard/data` |
| Subscriptions | 6 services × plans (`src/lib/digital-services.ts`) | `POST /api/digital/purchase` | `/dashboard/digital` |
| Proxies | 5 `plans` with `service: "proxies"` (`src/lib/catalog.ts`) | `POST /api/proxies/purchase` | `/dashboard/services/plan/[slug]` |

All three routes call `purchaseMappedProduct()` in
`src/lib/mapped-purchase.ts`. The gate, the mapping and the plan descriptors
live in `src/lib/product-mappings.ts`. `readServiceReadiness()` asks the same
gate, so the hub, `/status` and checkout cannot disagree.

The purchase sequence mirrors the existing gift-card route:

1. Session, same-origin, JSON, body cap, rate limit, UUID `requestId` (replay-safe).
2. `mappingMissingRequirements()` — with no key or no mapping, a neutral 503 and
   no wallet touch. The exact missing list is logged for the operator and
   returned by the diagnostics endpoint, never to a shopper.
3. A **pre-flight read** of the live FoxReload product. Its `deliveryType` must be
   `code`; direct top-ups are refused because Pryva has no verified recipient
   contract for them. Price/currency are converted to naira and
   `checkMargin()` refuses any mapping whose real cost breaks the margin floor.
4. Wallet debit and `processing` order row in one transaction, with a second
   replay check inside it.
5. FoxReload order → pay → poll for the delivery code, `requestId` as the
   idempotency key. The code is stored on the order (`referenceCode`) and shown
   on the receipt and `/dashboard/orders/[id]`.
6. Any upstream failure credits the wallet back and marks the order `refunded`.
   If the credit itself fails, the row is parked in `review` with a note so
   `/admin/reconciliation` shows a debit that still stands — the customer is
   never told a refund happened when it did not.

## How to turn one on

1. **Set the key.** `FOXRELOAD_API_KEY` (and optionally `FOXRELOAD_BASE_URL`,
   `FOXRELOAD_IS_MOCK`). The key is server-side only.
2. **Find a real product.** Use the read-only operator probe
   `GET /api/admin/suppliers` (admin session) or FoxReload's own product
   catalogue. Confirm, for the exact product:
   - its `id`;
   - `deliveryType` is `code` (a voucher/PIN Pryva can hand to the customer);
   - its price/currency, converted to naira, leaves at least the
     `MIN_MARGIN_RATIO` floor below the Pryva plan price. The checkout refuses
     a loss-making mapping at runtime, but check it before adding the row.
   - it actually delivers the thing the Pryva plan advertises (a 1 GB MTN data
     PIN, a Netflix plan voucher, a proxy credential — not a loosely named
     product).
3. **Set `PRODUCT_MAPPINGS_JSON`** to one row per plan (minified into one env
   value):

   ```json
   {
     "schema": 1,
     "products": [
       { "family": "data", "planId": "mtn-1gb", "productId": "product_abc123" },
       { "family": "subscriptions", "planId": "netflix-1month", "productId": "product_def456" },
       { "family": "proxies", "planId": "proxy-ng-1", "productId": "product_ghi789" }
     ]
   }
   ```

   `planId` must already exist in the Pryva catalogue for that family; the
   example product IDs above are illustrative, not verified products. One
   malformed, unknown or duplicate row invalidates the whole value — a partly
   enabled catalogue is worse than a paused one. For staging, write the same
   JSON to a file outside the repo and set `PRODUCT_MAPPINGS_FILE` to its path.
4. **Verify in staging first.** On a preview database set
   `FOXRELOAD_IS_MOCK=true` and buy one unit of each mapped plan. Confirm the
   code arrives on the order page, the wallet debit is exactly the catalogue
   price, and a forced upstream failure refunds the wallet. Real purchases are
   refused on a preview database without the mock flag.
5. **Deploy, then check the gate:**
   `GET /api/diagnostics/product-mappings` with
   `Authorization: Bearer <DIAGNOSTICS_SECRET>` (or `CRON_SECRET`). It reports,
   per family, `enabled`, our own mapped plan IDs and `missing`. It never returns
   real product IDs, costs or credentials to anyone but the operator.
6. **Do one small live purchase** per family before enabling the rest. A green
   readiness badge means the configuration is present, not that the product
   delivers what the label says.

## Still not covered

- **Direct top-ups** (`deliveryType: "direct_topup"` / `"login_topup"`): no
  verified recipient fields, so they are refused rather than guessed. Most data
  plans will need a code/PIN product.
- **Per-app verification codes** (92 example platforms): Fleexa's app listings
  remain read-only. Paid Fleexa purchases are still deliberately off until
  app/country mapping, pricing and reconciliation are verified in staging — see
  `GAPS.md`.
- **Residential proxies as live traffic**: a voucher product delivers
  credentials; it does not provision a rotating pool. If the catalogue offers
  only account credentials, say so on the plan page rather than implying live
  traffic is provisioned.
- **Automatic refunds on unknown outcomes**: FoxReload has no cancel endpoint
  wired here. An order paid upstream but never confirmed needs the operator
  queue; do not enable a product until its failure mode is understood.

## Files

- `data/product-mappings.json` — empty committed **template**; never put real IDs here.
- `src/lib/product-mappings.ts` — validation, plan descriptors, one gate.
- `src/lib/mapped-purchase.ts` — the shared purchase handler.
- `src/app/api/{airtime,digital,proxies}/purchase/route.ts` — the three routes.
- `src/app/api/diagnostics/product-mappings/route.ts` — read-only operator status.
- `src/components/purchase/MappedProductBuyButton.tsx` — shared checkout control.
- `src/test/product-mappings.test.ts`, `src/test/mapped-purchase.test.ts` — guards.
