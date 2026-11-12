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
