# Customer service grouping

Products are arranged by purpose, never by supplier or by how a code is delivered.
The same classifier is used for configured offers and digital catalogue results.

| Shelf | Contents |
| --- | --- |
| Number plans | Single-use number plans, bundles, rentals |
| App verification | App-specific SMS verification offers (distinct from generic number plans) |
| eSIM | Travel profiles and data plans from the connected feeds |
| Mobile data & airtime | Local mobile bundles and phone credit; existing delivery restrictions remain |
| Accounts | Account listings from the combined marketplace feeds |
| Subscriptions | Streaming, software, Premium, Nitro, and gaming memberships; activation codes and account-based activation belong together |
| Games & gaming | Games, keys, game currency, player-ID top-ups, including Call of Duty CP |
| Account top-ups | Non-game account credits, including Telegram Stars; Telegram Premium belongs to Subscriptions |
| Gift cards | Explicit gift cards, store/wallet credit, app-store credit and vouchers; Pryva wallet gifting is linked here but remains clearly labelled as Pryva credit |
| Prepaid & finance | Explicit prepaid/card products, without enabling unimplemented checkout |
| Social promotion | Followers, likes, views and related promotion, grouped by platform |
| Proxies | Proxy traffic plans; existing delivery restrictions remain |
| Email OTP | Free temporary inbox, not a paid subscription or email-account listing |
| Order tools | Bulk baskets and schedules, not a dumping ground for unknown digital codes |

Known product names take precedence over a supplier's delivery-type shelf.
Explicit gift-card names remain Gift cards even if the brand is a game.
Reviewed games, subscription codes and card products retain their own quote paths.
Unrecognized products retain supplier shelf context when known, otherwise they
remain visible only in All services, labelled category-unconfirmed. Names alone
cannot reliably classify every future SKU.

Digital categories include a cursor-paged whole-catalogue stream to find matching
products misplaced under other supplier shelves. Product-type navigation exposes
subcategories without loading the entire tree. A first page is not an exhaustive
catalogue; further pages must be loaded. Global search remains supplier-limited.

Standalone navigation entries for Telegram and Call of Duty were removed. Their
specialized purchase screens are still supported. Old generic digital shop links
without a selected product now open the shared hub. The temporary inbox has one
navigation entry; Pryva gift management is accessible from Gift cards and retains
its existing create/redeem/history functionality.

No live account inventory, paid purchase or production deployment was performed
for this reorganization. Classification does not establish stock, fulfillment,
regional eligibility or authorization to sell a product.

## Combined social and digital account listings

Both configured account feeds are now read into a shared browse snapshot rather
than using the secondary feed only when the primary fails. Manual products join
that same snapshot. Stable Pryva category IDs, subcategories, search and page
counts derive from the combined rows; checkout still resolves the exact original
opaque supplier token and rechecks the selected product.

The default account sort is lowest customer-facing Naira price first. Pricing
is resolved across matching combined listings before pagination, not just within
a supplier page. Category premiums and rounding are included. Listings are not
merged or removed merely because titles match. Other sorts remain selectable.

Complete browse snapshots are cached for five minutes, with concurrent reads
coalesced. Secondary page walks are limited to 25 calls per refresh to protect
its account-wide request budget. Larger or interrupted walks retain progress
and resume after a one-minute cooldown. The API and browser explicitly flag
incomplete results; their price ordering is only over the loaded catalogue.
The initial load is not a guarantee that every live SKU has been retrieved.
No supplier orders or production deployment were performed for this change.

## Follow-up visibility audit

- Live number/rental/inbox, app-verification, boosting and eSIM feeds now load
  independently in the hub. Working feeds render while slow ones remain pending;
  failures have a retry action and do not discard successful feeds. The aggregate
  API also reads independent sources concurrently rather than sequentially.
- The separate numbers feed includes the existing rental/inbox catalogue, not
  only OTP. No extra supplier checkout paths are authorized by this change.
- Games, subscriptions, gift cards/store credit, prepaid and eSIM digital shelves
  expose their stock filter. Buyers can include reported out-of-stock/unknown
  entries without enabling ordering. Product-type selection focuses its results
  instead of burying them behind unrelated tools/static listings.
- Category searches also query the whole digital catalogue and retain only
  recognized matching families, finding subscription codes and game products
  outside loaded category pages. Unrecognized categories remain browsable in All.
- More-expensive equivalent gift-card listings are no longer suppressed in the
  hub. Every returned offer remains visible with its own terms and checkout.
- Disney+ and additional named subscription/store-credit products classify into
  their purpose-based shelves, including in whole-catalogue search.
- Mobile data/airtime and proxies still lack supported fulfilment; display fixes
  do not enable sales. Empty data and subscription views explain their status
  instead of implying a working key guarantees products.

This is a code-path audit with mocked supplier regression tests and a local
production build, not an authenticated live inventory verification or deployment.

### API-only account marketplace (owner decision)

New account listings and categories now come exclusively from configured API
catalogues (currently Bulkacc in production). Manual inventory is no longer
merged into browsing or used as a fallback when APIs are absent. Old manual
listing tokens cannot resolve for a new purchase; historical order data and
fulfilment tooling are retained for existing orders.

Listing responses preserve API stock counts, including zero and unknown (null).
Unknown and insufficient stock do not advertise a buyable listing. Known stock
continues to be checked against the supplier at checkout, and prices remain
sorted lowest first. No stock counts are invented for missing inventory.
