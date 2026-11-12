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
