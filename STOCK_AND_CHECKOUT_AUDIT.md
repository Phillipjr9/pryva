# Stock visibility and checkout audit — 2026-11-11

Scope: repository code inspection, not authenticated live supplier enumeration.
No purchases placed. No claim that every current product has been checked live.

## Confirmed findings

| Family | Stock visibility / purchase restriction |
| --- | --- |
| Number plans | OTP adapters carry supplier stock/count fields; null remains possible. Supplier configuration, current quotes and checkout validation still apply. |
| eSIM | Live explorer mapping explicitly sets stock:null. This is not evidence of unavailable service. Requires provider-specific capacity/availability interpretation. |
| Mobile data & airtime | ClubKonnect catalogue browsing exists; purchase route explicitly returns 503. Stock availability cannot repair unfinished fulfillment. |
| Social & Digital Accounts | Bulkacc inStock and marketplace available_stock are mapped. Unknown counts remain possible. Admin report ACCOUNT_SAMPLE=40 is not a full catalogue. |
| Subscriptions | Generic plans and purchase endpoints return 503; selected reviewed digital products have separate checkout paths. |
| Games / Account top-ups / Gift cards / Prepaid & finance | FoxReload browse allowed but checkout requires a matching reviewed ID and exact product name, with a supported codes/topups/esims path. Sufficient stock alone does not authorize fulfillment. |
| App verification | Registry declares catalogue mode. OTP listing availability and supported checkout must be checked per supplier/product, not inferred from the category. |
| Social promotion | Explorer explicitly sets stock:null. Provider order minimum/maximum is a purchase bound, not remaining inventory. |
| Proxies | Generic plans and purchase endpoints explicitly return 503; serviceConfigured also returns false. |

## Fixed in this increment

FoxReload catalogue route previously reduced a valid numeric product.quantity
into reported/out/unknown, dropping the actual count. The explorer then always
assigned stock:null even when a numeric count existed upstream.

The route now exposes stockQuantity for safe nonnegative integer quantities;
the explorer retains that count. Zero stays zero; missing/invalid quantity stays
null. Stock numbers are public catalogue data, not supplier costs or credentials.
Checkout allowlisting and purchase protections remain unchanged.

## Other confirmed visibility constraints

- Default digital stock-only filter requests withStockOnly from supplier.
- All pagination must finish before calling any product count complete.
- Reviewed digital offers initially carry stock:null pending live quote.
- Supplier/API failures must not become "out of stock" or fabricated quantities.
- Existing data/subscriptions/proxies service gates are false; removing those
  without working delivery/reconciliation would expose unsafe purchase promises.

## Remaining work

Authenticated all-page supplier snapshots, per-product rejection reason exports,
provider availability metadata, and complete inventory history are not provided
by this audit. The workspace has no supplier environment file, and outbound
sandbox networking is restricted to development/GitHub hosts; live supplier
requests cannot be verified here directly. Production-side read-only inventory
collection needs a secured implementation and deployment, not a purchase test.
