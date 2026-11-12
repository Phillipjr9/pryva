# Catalogue reliability audit — 2026-11-11

## Implemented and locally verified

- Shared-snapshot reads now coalesce concurrent requests inside each instance,
  so shoppers in that instance share a single database read/lease waiter.
- Boosting catalogue now uses PostgreSQL shared snapshots in persistent deployments,
  scoped to a hash of supplier URL and credential. One shared refresh per scope;
  browser refresh cannot bypass the 30-second freshness window.
- Inbox and rental catalogues share separate snapshots, so failure in one source
  does not hide the other. Scope includes hashed account identity, never a raw key.
- Shared supplier wrapper preserves original fetchedAt, reports stale reads as
  degraded, and refuses last-good data older than five minutes. Incomplete
  refreshes cannot replace a complete value in this wrapper.
- No result-count slices were introduced; browsing retains every returned row.
- Client read-only catalogue retries, bounded deadlines, three-worker digital
  request pool and recoverable pagination are included in the working tree.
- Account categories abort on unmount; paid purchase requests are not retried by
  the catalogue helper. No browser-persistent customer data cache introduced.
- Data catalogue API/browser implementation is also pending in this branch;
  ClubKonnect purchases remain unfinished, not silently enabled.

## Inspected, no infrastructure changes

Database pool settings already bound connection counts and connection waits and
handle idle connection errors. Default max is 10 per instance, timeout 30 seconds
for an Aurora instance that may need to wake. Reducing timeouts blindly could
make cold login failures worse. Actual aggregate connection capacity and Aurora
settings were not inspected or changed. A proxy/pool sizing decision needs real
connection telemetry and authorized infrastructure changes.

## Remaining audit/verification work

- eSIM and OTP catalogue caches still have process-local components; shared
  snapshot migration and detailed provider-specific stale/partial semantics
  require further work. Do not describe all feeds as globally cached.
- FoxReload catalogue cursor/search reads require additional cross-instance
  caching audit; bounded browser concurrency is not a global supplier budget.
- Cold snapshot failure cooldown/recovery behavior needs further stress testing.
- Login/logout failure has not been reproduced with a production test identity.
- No load-capacity certification, production stress test, supplier paid call,
  infrastructure upgrade or real wallet transaction performed.
- No monitoring alerts or new operator health dashboard implemented yet.
- Large catalogue response bytes and server pagination need further measurement;
  12-card UI batches limit rendering but not every upstream response size.

## Validation

91 tests passed across 10 focused files, including shared snapshot PostgreSQL/
PGlite lease tests, snapshot policy tests, catalogue client tests and supplier/
UI regressions. Typecheck, full ESLint, production build and diff check passed.
Not the full repository test suite. These changes are not deployed at this stage.

## 2026-11-12 follow-up — local changes only

- Account category/listing and mobile-data browsers allow 65 seconds for routes
  with a 60-second execution budget. Obsolete account reads are cancelled when
  filters change or the page unmounts.
- Read-only retries are bounded and cancellable. Rate limits include a
  `Retry-After` cooldown; missing or long 429 cooldowns are not immediately
  retried. Digital browsing and live service feeds keep successful results and
  retry only failed shelves, cursors or feeds. Regional digital pages preserve
  their previous page during a failed refresh. Digital types and mobile data
  also wait for cooldowns.
- The digital catalogue distinguishes a disabled environment, an unconnected
  or rejected integration, a signed-out user and a temporary throttle/outage.
  Checkout gates and supplier request budgets have not been relaxed.
- An expired in-process account fallback is marked stale and cannot be
  republished as a fresh shared catalogue. Existing complete shared snapshots
  still remain available during refresh failures.
- Local code inspection found possible deadline and request-amplification
  problems. This does **not** establish which production failure the affected
  shoppers saw, or prove that a deployment is fixed.

### Production investigation

For each affected page, collect the page URL, approximate UTC time, environment
(production or preview), failing catalogue endpoint, HTTP status, and its
`Retry-After` header if present. Do not collect cookies, authorization headers,
API keys, account credentials or complete supplier responses. Check runtime logs
(not only deployment build events) for `Digital catalogue read failed`,
`Mobile data catalogue unavailable`, `Initial snapshot refresh failed`, or
`Shared rate-limit store unavailable`; redact any sensitive details. Check
integration configuration without exposing secret values. A 401, 429, and 503
require different follow-up and should not all be assumed to be supplier outages.

### Local validation

The production build, TypeScript and ESLint passed. The full test run passed
3,183 tests and failed four tests that also fail on the untouched base commit:
three older mobile-data UI expectations and one supplier-copy check. Focused
account snapshot, cooldown and catalogue recovery regressions passed. These
results do not verify live integrations.

This validation was performed on the working branch before production
verification. No authenticated production catalogue request or paid transaction
was performed as part of the local audit.

## 2026-11-12 app-verification investigation — local only

The previous Bitcall listing code relied on country fields on global service
rows, although the documented rows can omit them. The local adapter now reads
published country codes and requests services using `country_code`, then
rejects contradictory explicit country metadata. Empty, loading, partial and
unavailable verification feeds are presented separately. The admin stock report
uses the same country-filtered reads instead of assuming country rows contain
pools.

Before an activation, checkout independently reads the exact published offer and
checks its country, reported stock, convertible price and margin. An unreadable
or mismatched offer is refused before the paid-call marker; an ambiguous paid
response remains in review without a wallet debit or automatic retry. The
provider's documented activation body has no price-limit field, so this read is
not a price lock: a change between confirmation and activation remains possible.

Filtered catalogue attribution relies on Bitcall honoring its documented filter;
individual list pools can omit country metadata. Exact-offer confirmation avoids
a wrong-country purchase, but does not independently verify every displayed
listing. Country/offer caches, request coalescing and the throttle cooldown are
per instance, not a cross-instance provider quota; walks have bounded pages and
deadlines. No live supplier response, paid activation or production deployment
was made during this investigation. The shopper reports zero across all
countries; the authenticated production response remains unknown, so the code
mismatch is a plausible cause, not proof of the reported zero.

Local validation: 258 focused tests passed, including a synthetic provider
catalogue covering every country in the selector. This is not proof of actual
supplier coverage. Before the final country-name refinement, the full suite
passed 3,240 of 3,244 with the same four previously recorded mobile-data and
supplier-copy failures. Typecheck, lint, production build, pricing audit and diff
check also passed.

### Combined production baseline

Production subsequently moved to `26f2b08`, which includes a residential-proxy
release and migration `0046_proxy_slots.sql`; the live build log reports 48
migrations recorded. The working branch was fast-forwarded to include that
production commit before the OTP changes, so an eventual deployment would not
overwrite the proxy release. Production and main must still be checked again
immediately before promotion, since another release could land in the meantime.

The first combined full suite reported 16 failures, all reproduced against an
untouched snapshot of `26f2b08`; they include a broken `/dashboard/proxies` link
and four test fixtures that did not replay migration 0046. The fixture lists
were updated and the five financial/migration test files then passed 178/178.
The final full run passed 3,247/3,259 tests; the remaining 12 failures reproduce
on the untouched production baseline and have not been fixed. The final 19-file
catalogue, proxy and safety selection passed 321/321 tests. The combined build,
typecheck, lint and pricing audit passed. An empty supplier page that claims a
positive total, or a nonempty page claiming zero, now fails as incomplete rather
than being presented as a complete catalogue.

The Vercel configuration has `FORCE_LIVE_LISTINGS` enabled for previews. In the
live baseline it bypasses the shared financial-action guard, not just listing
reads. The new code makes Vercel preview fail that guard even when the flag is
set; it also fails closed on a Vercel production deployment with no configured
database. A simulated checkout test confirms the supplier gate is never opened
in that case. Existing older preview deployments keep their old code and require
separate attention; neither this guard nor a preview is a substitute for keeping
production database and supplier credentials out of preview. The configuration
itself was not changed.

The owner confirmed that a verified backup is available, but it was not
independently inspected. The OTP fix adds no migration; its migration files and
runner match `26f2b08`, whose build reported all 48 files recorded. No paid test
order was placed.
