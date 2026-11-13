# ClubKonnect integration progress

## Current state

Not production-ready. No customer checkout is enabled. Credentials must be server-only:
`CLUBKONNECT_USER_ID`, `CLUBKONNECT_API_KEY`. No paid calls made.

Implemented: bounded HTTPS transport, fixed provider host, redirect refusal,
credential-safe errors, data catalogue parser with exact kobo amounts and no
invented stock, conservative transaction-status interpreter, RequestID lookup,
and explicit read-only catalogue endpoint allowlist for eight service families.
Other catalogue contracts are raw/server-only and require normalization before UI use.

## Catalogue read behaviour (customer-facing)

`APIDatabundlePlansV3.asp` is called with `UserID` only; the API key is not part of
that request, so the catalogue route gates on the identifier alone
(`isClubkonnectCatalogueConfigured`). Reading tolerates individual bad rows and
reports how many it skipped plus any network with no readable bundle, rather than
withholding every bundle because one row was malformed. A payload the host answers
with a refusal status (`INVALID_CREDENTIALS`, `MISSING_PHONE_NUMBER`) is reported to
the route as `ClubkonnectAccountError` so the page does not invite retries that
cannot succeed; the status word reaches only the log and
`/api/diagnostics/integrations` (`mobileData.catalogue`), never a customer.

## Scope and documented requirements

| Service | Purchase endpoint | Catalogue | Required recipient handling |
| --- | --- | --- | --- |
| Airtime | APIAirtimeV1.asp | APIAirtimeNetworkV2.asp | MobileNetwork, Amount, MobileNumber; refresh network limits |
| Data | APIDatabundleV1.asp | APIDatabundlePlansV3.asp | MobileNetwork, PRODUCT_CODE as DataPlan, MobileNumber |
| Cable TV | APICableTVV1.asp | APICableTVPackagesV2.asp | CableTV, Package, SmartCardNo, PhoneNo; APIVerifyCableTVV1.asp first |
| Electricity | APIElectricityV1.asp | APIElectricityDiscosV1.asp | ElectricCompany, MeterType, MeterNo, Amount, PhoneNo; APIVerifyElectricityV1.asp first; preserve prepaid token |
| Recharge PINs | APIEPINV1.asp | APIEPINDiscountV2.asp | MobileNetwork, Value (100/200/500), Quantity (1–100); TXN_EPIN array, private print view |
| Smile | APISmileV1.asp | APISmilePackagesV2.asp | MobileNetwork=smile-direct, DataPlan, verified Smile account ID in MobileNumber; Amount only for airtime (100–50,000) |
| WAEC | APIWAECV1.asp | APIWAECPackagesV2.asp | Live ExamType, PhoneNo; private carddetails delivery |
| JAMB | APIJAMBV1.asp | APIJAMBPackagesV2.asp | Live ExamType, PhoneNo; profile verification contract needs clarification |

All provider endpoints are at https://www.nellobytesystems.com/.
Official reference pages: https://www.clubkonnect.com/APIParaGetAirTimeV1,
APIParaGetDataBundleV1, APIParaGetCableTVV1, APIParaGetElectricityV1,
APIParaGetEPINV1, APIParaGetSmileV1, APIParaGetWAECV1, APIParaGetJAMBV1,
APIParaGetDisputeResolutionV1 (same origin).

Betting-wallet funding is excluded from implementation.

## Safety requirements before activation

- Durable order intent and wallet reservation before submission; user-scoped idempotency.
- Reconcile timeout by RequestID; do not blindly repeat a purchase.
- Code 200 plus ORDER_COMPLETED confirms normal transaction success. Code 201
  can also say ORDER_COMPLETED but means network unresponsive, not delivered.
- Code 412 may be automatically retried; do not refund on generic ORDER_ERROR.
- Code 521 is ambiguous (completed/cancelled/refunded); manual reconciliation.
- PIN delivery needs a service-specific parser: EPIN success can lack statuscode.
- Unsigned callback data must never directly credit/refund/complete orders;
  use authenticated server-side APIQueryV1.asp and verify order identity.
- Verify customer before bill payment; bind verification to exact submitted inputs.
- Do not infer carrier from phone prefix (number portability).
- Fresh server-side product/price checks and explicit customer confirmation.
- Persist private tokens/PINs without exposing them in logs, shared caches or analytics.
- Separate provider balance from customer wallet balance.
- Account-specific discounts and margin must be validated; never treat example
  amounts or malformed discount fields as guaranteed wholesale cost.

## Pending work

1. Normalize remaining live catalogue contracts and account-specific pricing.
2. Implement verified recipient lookup and safe, rate-limited APIs.
3. Durable checkout, supplier submission, periodic reconciliation and refunds.
4. Purpose-based dashboard pages: mobile services, bills, education, recharge PINs.
5. Owner-only receipt/PIN/token delivery and printable recharge cards.
6. Regression tests for duplicate orders, concurrent spends, timeouts, callbacks,
   pending outcomes, terminal failure, sensitive output and historical orders.
7. Typecheck, lint, build, integration tests, then controlled authorized activation.

Do not present this checklist or the existing adapter as a completed integration.

## Required branding (owner request)

Every provider/product choice, plan card, confirmation and receipt must display
its relevant provider logo alongside its full accessible name, not only generic
service icons. Cover airtime/data networks, Smile, cable providers, electricity
discos, WAEC and JAMB. Resolve identities using supplier codes, not substring
matches that can confuse different providers. Handle legacy/renamed carriers
without showing an unrelated mark.

Reuse existing BrandIcon artwork where accurate. Acquire remaining actual logos
from official or appropriately licensed sources; keep source/licence notes and
host assets locally. Do not generate or redraw fake official logos. Until a real
asset is available, use a plainly labelled text fallback (not a claimed logo).
Use contain sizing, adequate contrast, stable dimensions and graceful broken-
image fallback. If adjacent text names the provider, artwork should be decorative;
otherwise provide its accessible name. Logos do not imply affiliation.

Branding is pending: this requirement is not proof that assets or UI are complete.

## Follow-up: live data browsing

Implemented authenticated /api/airtime/plans with per-user rate limiting,
account-scoped shared one-minute snapshots, original timestamp/stale metadata,
30-minute hard fallback age limit, and private/no-store responses. Data page
now fetches actual API bundles with network selection, search, cheapest-first
supplier-published prices, reload/error states and existing carrier artwork or
explicit text fallbacks. No retail quote or numeric stock is fabricated.
Checkout remains explicitly pending. Remaining families and branding assets are
not yet connected to customer pages. No existing working purchase route changed.
