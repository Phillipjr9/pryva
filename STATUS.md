# Pryva — verified status review

**Date:** 30 October 2026 (updated) · **Base commit:** `19113f0` (`main`) · **Branch reviewed:** `arena/0c5fc242-pryva` · **Last verified head:** the sixteenth pass, §24
**Method:** every claim below was read out of the code or produced by running the project. Nothing is taken from `PLAN.md` without checking it first — and several `PLAN.md` entries turned out to be stale (section 4).

---

## 0. Health check (run in this checkout)

| Check | Result |
|---|---|
| `npm ci` | clean install, 534 packages |
| `npm run typecheck` | **0 errors** |
| `npm run lint` | **0 warnings/errors** |
| `npm test` | **1,078 tests / 119 files, all passing** (no `.skip`, no `.only`) |
| `npm run build` | **passes**; 75 API route handlers, 23 public pages, 17 dashboard pages, 12 admin pages |
| Boot with no `DATABASE_URL` | `npm start` → `/api/health` = `{"status":"healthy","mode":"preview"}`; `/`, `/pricing`, `/status`, `/accounts` = 200; `/dashboard` = 307 (auth redirect) |

Codebase size: ~52,600 lines under `src/`, 101 modules in `src/lib/`, 23 database tables, 17 migrations (`0000`–`0016`).
Migration coverage is complete — every table in `src/db/schema.ts` is created by a migration.

**Summary in one line:** the engineering is in better shape than the planning docs suggest; the real gaps are (a) product surface that was never built, (b) operations/deployment wiring, and (c) documentation that no longer matches the code.

---

## 1. What can actually serve a paying customer today

| Capability | State | Gate / caveat |
|---|---|---|
| Paystack wallet top-up | **Live** | `PAYSTACK_SECRET_KEY` + `NEXT_PUBLIC_APP_URL`; signed webhook + browser verify, single credit |
| Withdrawals | **Partly live** | request → admin approve → **manual** completion. No `transfer.success/failed` settlement (README says so; no handler exists) |
| Virtual numbers / rentals | **Live for 10 of 37 plans** | `FULFILMENT_MAP` in `src/lib/fulfillment.ts`; needs the number provider key + margin floor |
| Accounts marketplace | **Wired, currently empty** | `BULKACC_API_KEY`; production `/api/accounts/categories` returns only an empty "Streaming" category (suspected unfunded supplier balance) |
| Gift cards | **Live** | minted internally from the buyer's wallet (`PRYVA-` codes), no supplier needed |
| Free disposable inbox | **Built** | migration `0013`, `POST /api/inbox`, `/api/inbox/poll`, `/api/inbox/discard`, `/dashboard/inbox`. The paid tier is not built |
| Transactional email | **Built, poorly scheduled** | `wallet_email_outbox` + Resend + cron; `vercel.json` runs it **once a day** while README requires ~once a minute |
| Admin console | **Live** | 10 pages; every `/api/admin/*` handler goes through `authorizeAdminApi()` |

### Demo-only or deliberately disabled
eSIM, proxies, digital subscriptions, airtime/data, bulk orders, scheduled orders, SMM boosting, and all live supplier purchases outside the allowlist. Their routes return an actionable 503 or simulate in the preview database. The automatic-refund and scheduled-order crons **refuse a persistent database**, so they do nothing in production.

---

## 2. Not built at all (verified absent — zero hits in `src/`)

| # | Feature | Notes |
|---|---|---|
| 1 | **Referral program** | no codes, tables, routes or pages |
| 2 | **Wishlist / saved listings** | nothing |
| 3 | ~~**Reviews & ratings**~~ | **Built in the eighth pass** — verified-purchase reviews, published only after moderation; `/testimonials` remains curated copy and says so |
| 4 | **Coupons / discount codes** | only supplier promo codes on the marketplace; no Pryva coupon system |
| 5 | **Support tickets** | `/dashboard/support` + `/admin/messages` handle flat `contact_messages`; no threads, priorities or SLA |
| 6 | ~~**Two-factor authentication**~~ | **Built in the fourth pass** — TOTP enrolment, recovery codes and a two-step sign-in; migration `0015` |
| 7 | **SMS / WhatsApp notifications** | nothing (no Termii/Twilio/WhatsApp client) |
| 8 | ~~**PWA**~~ | **Built in the sixth pass** — web manifest, installable icons, offline page and a deliberately narrow service worker |
| 9 | **Product analytics / Web Vitals** | nothing — no GA4, no `@vercel/analytics`, no `web-vitals` |
| 10 | ~~**Admin audit log**~~ | **Built in the second pass** — `admin_audit_log` (migration `0014`), `/admin/audit`, `GET /api/admin/audit` |
| 11 | ~~**Admin reconciliation view**~~ | **Built in the third pass** — `/admin/reconciliation` lists in-flight withdrawals, orders with an unknown supplier outcome, refunded-but-not-released orders and stale pending deposits, oldest first |
| 12 | **Paid inbox tier** | schema supports `tier='paid'`, the code only issues `free`; price needs the supplier's real `priceNgn` |
| 13 | ~~**CSP**~~ | **Added in the fifth pass** — `src/lib/security-headers.ts`, served by the proxy, with the asset hosts pinned by a test |
| 14 | **Dockerfile** | CI (`.github/workflows/ci.yml`) and an operations runbook (`RUNBOOK.md`) were added in these passes; no Dockerfile — deployment is Vercel-only |
| 15 | ~~**Gift-card explainer page**~~ | **Built in the seventh pass** — `/gift-cards`, generated from the same rule constants the checkout enforces |
| 16 | **Self-service account deletion** | deliberately returns 503; panel points at support |

Rough sizing: 1, 2 and 4 are S–M; 5, 10, 11, 13 are M; 7 is M; 9 is S.

---

## 3. Built but incomplete

| Area | What exists | What is missing |
|---|---|---|
| Marketplace inventory | 3-lane routing (`p1`/`p2`/`p3`), pricing engine, checkout, manual fulfilment queue | **No products coming back from the supplier** — the catalog is connected and empty. This is the biggest revenue blocker and probably an account-balance problem |
| Withdrawal settlement | approve + manual complete, idempotency, name-match rule | no Paystack `transfer.*` webhook handling; no merchant OTP finalisation. Every payout needs an operator |
| Live fulfilment | number/rental allowlist, margin guard, compensation cancel | eSIM, proxies, subscriptions, airtime and data have **no live provider mapping at all** |
| Crons | 3 routes, all secret-gated | only 2 are scheduled in `vercel.json`; `scheduled-orders` is never invoked; the email worker is daily, not minutely |
| Email verification | tokens, `/verify-email`, resend, admin requires a verified address | not enforced for ordinary password signups (README:92 admits this) |
| Demo ↔ live parity | large simulated demo | demo behaviour diverges from live in refunds, scheduled runs and marketplace |

---

## 4. Needs correcting (documentation and configuration drift)

These are wrong *today*, not feature requests.

1. ✅ **`README.md:167` contradicted the shipped code.** *(fixed — the paragraph now says numbers/rentals run for the ten allowlisted plans when the provider is configured, and only the genuinely disabled categories are listed as disabled)* It says "Live virtual-number, email, eSIM, proxy, digital/data, airtime, bulk and scheduled purchases are disabled", but `src/lib/fulfillment.ts` implements live number/rental purchases for 10 plans, `/pricing` sells them, and `/status` advertises "Automatic · 10 of 12". Either the README is stale or that purchase path is unintended — this needs a decision, because both readings are defensible from the repo.

2. 🟡 **`PLAN.md`'s backlog is stale and will mislead the next session.** *(a warning now sits above §0 pointing at this file; the tables themselves are **not** rewritten)* It still marks as missing: README, the refund/cookie policies, the settings data-export UI, admin user/order/refund/message/margin pages, admin role gating, and the disposable inbox — all of which now exist. It also claims (#15) that `transfer.success/failed` webhooks settle or refund withdrawals; there is no such handler and the README correctly says there isn't.

3. ✅ **`/status` rendered a hardcoded false row.** *(fixed — gift cards now have their own Available row, and the remaining categories say "preview only, no verified live fulfilment"; a test pins it)* `src/app/(site)/status/page.tsx:70` prints *"Digital subscriptions, gift cards, data, bulk and scheduled orders — Not available"*, but gift cards work and are sold. Same class of bug as the "Number fulfillment: Paused" literal that was already fixed once.

4. ⬜ **Cron scheduling is incomplete and mismatched.** *(not touched — needs your call on plan/tier and whether these jobs should run live at all)* `vercel.json` lists only `wallet-emails` (daily 03:10) and `auto-refund` (daily 03:40).
   - **Correction to the first version of this report:** `scheduled-orders` is *deliberately* absent. It exports only `POST`, while Vercel Cron issues `GET`, so scheduling it would register a job that is answered `405` forever. `src/test/cron-schedule.test.ts` pins exactly that, plus the Hobby plan's two-job daily limit.
   - The real gap is that live scheduled fulfilment and live automatic refunds are disabled anyway (both routes refuse a persistent database), so no schedule would help until that changes.
   - The wallet-email outbox README requires a **per-minute** scheduler and a 23-hour cutoff; a daily run cannot meet it. Moving it needs Pro or an external scheduler — your call.

5. ✅ **`DIAGNOSTICS_SECRET` was missing from `.env.example`** *(added, with a note on why it is separate from `CRON_SECRET`)* although `src` reads it and README documents it. A new deployment cannot discover the variable from the template.

6. ✅ **Package identity was still the template.** *(renamed to `pryva`)*

7. ✅ **Two Drizzle configs.** *(the `.json` with its hardcoded `postgresql://postgres:postgres@127.0.0.1:5432/app_db` is deleted; the `.ts` comment no longer claims 12 tables)*

8. **The repository is public and contains wholesale cost data.** `data/cost-sheet.json`, `data/manual-catalog.json` and the sourcing notes are readable by anyone. README warns about it; nobody has acted on it.

9. **Preview deployments still read and write the production database.** `PGHOST`/`PGUSER`/… target `preview` and `production`; the migration *build step* is gated on `VERCEL_ENV`, but runtime data access is not. Recorded as the owner's call in `PLAN.md`.

10. 🟡 **Deployment wiring is half in the repo.** *(partly fixed — `.github/workflows/ci.yml` now exists and `RUNBOOK.md` documents the build command, migration gate and env scoping; the workflow has never run because GitHub Actions is blocked on this account's billing, so treat CI as unproven)* Env scoping and the cron cadence still live only in the Vercel dashboard, and a fresh clone cannot see which environment variables are scoped to which environment.

---

## 5. Open pull requests worth deciding on

| PR | Title | State |
|---|---|---|
| **#17** | *Run the checks on every change, and make one of them able to fail* | **Open, now superseded** — its two substantive changes (CI workflow, `pricing:audit` exit code) were ported into this branch directly. Close it, or rebase if its extra bundle-scanning step is still wanted |
| **#34** | *Record that the probe is blocked by egress, not by the credential* | Open — docs only; records that this sandbox cannot reach production |
| **#8** | *Payment flow design: paying overlay, receipt, funding receipt and money motion* | Open since 27 Oct — likely superseded; close or rebase |

---

## 6. Dependencies worth updating

`npm outdated` (majors available): **TypeScript 5.9 → 7.0**, **ESLint 9 → 10**, **Vitest 4 → 5**, **jsdom 26 → 30**, **dotenv 17 → 18**, **Tailwind 4.1 → 4.3**, `@types/node` 22 → 26. Minor/patch: `react` 19.2.6 → 19.3.1, `pg` 8.20 → 8.23, `drizzle-orm` 0.45.2 → 0.45.4.
These are healthy upgrades to schedule, not emergencies. Pin them behind the CI in PR #17 rather than doing them blind.

---

## 7. Blocked on you, not on code

1. **Account-supplier balance.** The feed is connected and returns zero products. Until that account can serve a catalog, the marketplace is a storefront with empty shelves.
2. **Are live number purchases on or off?** Answering this resolves item 4.1 and lets the README, `/status` and `/pricing` agree.
3. **Paid inbox price.** It must be derived from the supplier's real per-inbox cost through the existing 30–50% band; the standing rule is not to guess pricing.
4. **Email domain / Resend sender**, then decide whether signup must verify ownership before spending.
5. **Make the repository private**, or move the cost sheets out of it, before launch.
6. **Preview database isolation** — whether PR previews may keep touching production data.

---

## 8. Recommended order

1. ~~Merge PR #17 / add CI.~~ **Done in this pass** — the workflow is in the branch and the price gate now fails correctly.
2. ~~Make the truth surfaces agree.~~ **Done for README and `/status`**; the `PLAN.md` tables still need a proper rewrite, and the "are numbers live?" question is now answered by the documentation rather than left ambiguous.
3. 🟡 **Fix operations** — the scheduled-orders mystery is resolved (it cannot be scheduled as written); still open: the email worker's cadence, and whether transfer webhooks will ever settle withdrawals or operators always will.
4. 🟡 **Finish the money loop** — the admin audit log and the reconciliation view are done; still open: reconcile the supplier balance and enforce email verification on signup.
5. 🟢 **Then growth features** — referrals, coupons, wishlist, analytics. 2FA, the PWA, the CSP and verified-purchase reviews are built (sections 12–16). What remains is additive; none of it unblocks revenue the way 1–4 do — and referrals and coupons need your reward figures before they can be written.

---

## 9. What changed in this pass (30 Oct 2026, branch `arena/0c5fc242-pryva`)

| Change | Why |
|---|---|
| `README.md:167` rewritten | It said live number purchases were disabled; the code, `/pricing` and `/status` all said otherwise. The paragraph now describes what the code does: live numbers/rentals for the ten allowlisted plans when the provider is configured, free inbox live, and only eSIM/proxy/digital/data/airtime/bulk/scheduled still disabled |
| `/status` gift-card row fixed **and tested** | The page told visitors gift cards were unavailable while the dashboard sold them. Gift cards now have their own `Available` row; the rest say "preview only". Sabotage-proven: restoring the old row fails the new test |
| `scripts/build-prices.mjs` exit fix | `pricing:audit -- --check` printed `1 OUT OF BAND` and still exited **0** — a gate that could never fail. Now exits 1. Verified both directions with a temporary out-of-band cost and a byte-identical restore |
| `.github/workflows/ci.yml` added | Typecheck → lint → profit-band check → tests → production build on every PR and push to `main`. No secrets needed |
| `DIAGNOSTICS_SECRET` added to `.env.example` | The variable is read by `src` and documented in the README, but a new deployment could not discover it from the template |
| `package.json` renamed to `pryva` | It was still the template name |
| `drizzle.config.json` deleted, comment corrected | Duplicate config with a hardcoded localhost credential; the surviving `.ts` comment claimed 12 tables when there are 17 |
| `PLAN.md` staleness warning | §2 still marks ~10 shipped items as missing and wrongly credits transfer webhooks. The tables are left intact deliberately — rewriting 66 KB of history is a separate job — but no future session should read them as current |
| `STATUS.md` added | This file: the verified snapshot everything above is measured against |

**Verified after the changes:** `typecheck` 0 errors · `lint` clean · **844/844 tests** · `build` passes · `pricing:audit -- --check` exits 0 in band and 1 when sabotaged.

**Still open from §4:** cron scheduling (#4), the public repo exposing cost sheets (#8), preview/production database sharing (#9), and deployment wiring living only in the Vercel dashboard (#10).

---

---

## 10. Second pass — the admin audit trail (30 Oct 2026)

The first pass found that privileged actions left a line in the application log and nothing durable in the database. That is now built.

| Piece | Detail |
|---|---|
| Migration `0014_admin_audit_log.sql` | `admin_audit_log`: actor id **and** a snapshotted email, dotted action verb, target type/id, a redacted summary, timestamp. Append-only; indices on time, actor and target |
| `src/lib/admin-audit.ts` | `recordAdminAction()`. Best-effort by design: it returns `false` and logs loudly when the insert fails rather than throwing, because it runs *after* money has already moved — a failed audit write must not make a committed refund look retryable. The wallet ledger remains the authoritative financial record; the file says so |
| Wired into | refunds (`order.refund`), withdrawal approve/reject/complete, fulfilment deliver/unsourceable, admin wallet credit/debit, support message status |
| Surfaces | `/admin/audit` page with action filters, search and pagination; `GET /api/admin/audit` (read-only, admin-gated); "Audit" in the admin nav |
| Secrecy | The delivery summary records the **item count**, never the credentials — pinned by a test that fails if `credentials` is interpolated. Support message bodies are never copied |

**Verified:** 855 tests / 95 files · typecheck · lint · build. Sabotage-proven three ways: rethrowing from `recordAdminAction` fails two tests, interpolating credentials into the summary fails the secrecy guard, and removing an audit call is caught by the static route scan.

**Also in this pass:** `RUNBOOK.md` — the operations document that did not exist. It covers the deploy/migration gate, secret rotation, what each cron does (and why one is deliberately unscheduled), withdrawal and refund reconciliation, incident playbooks and the guards that must not be deleted.

**Fixture lesson:** adding a migration makes four PGlite fixtures fail on purpose — `withdrawal-name-check.test.ts` asserts every fixture replays every migration. They now include `0014`, and the manual migration list in `migrations/README.md` was replaced with a glob so it cannot fall behind the directory again.

---

---

## 11. Third pass — the reconciliation queue

The money loop had one gap left that a coder could close: nothing showed an operator **what was still unresolved**, only what had already happened.

`/admin/reconciliation` (nav: Reconciliation) is read-only and separates four classes, because the action differs:

| Class | Why it is here |
|---|---|
| Withdrawals in `processing` | the transfer may already have left; rejecting would refund a payout that could still arrive |
| Orders in `processing` / `review` | supplier outcome unknown, or unsourceable and awaiting a refund decision |
| Refunded orders carrying a reconciliation note | customer credited but the upstream unit may still be live — exposure, not a task to close |
| Deposits `pending` for over an hour | an abandoned checkout and an unconfirmed payment look identical; only Paystack distinguishes them |

Ages are bucketed (`fresh` under an hour, `watch` under a day, `urgent` beyond) with the count older than a day in the header. Bank **account numbers are never selected**, and no supplier is named — the operator gets the reference to reconcile with, which is what the job needs.

`src/lib/reconciliation-queue.ts` holds the age arithmetic: a future timestamp clamps to zero instead of sorting above older items, and an unparseable date counts as new instead of becoming `NaN`, which would compare false against every threshold and hide the row.

**Verified:** 861 tests / 97 files · typecheck · lint · build. The page test seeds one row of each class and asserts they render, that the age appears, that `0123456789` does **not**, and that the page says nothing resolves itself — sabotage-proven by rendering the account number, which fails the test.

---

### How this was verified

```sh
npm ci && npm run typecheck && npm run lint && npm test && npm run build
PORT=3000 npm start   # then curl /, /api/health, /status, /pricing, /accounts, /dashboard
grep -rni "referral|wishlist|coupon|totp|termii|whatsapp|manifest|gtag|audit_log" src
find src/app/api/admin -name route.ts; cat vercel.json; cat next.config.ts
```

Feature claims marked "absent" mean zero matching code in `src/`; "built" means the file was read, not that a live third-party call was made. No live supplier, Paystack or Resend credentials are present in this environment, so nothing here proves a third-party integration works — only that the code path exists.

---

## 12. Fourth pass — two-factor authentication (30 Oct 2026)

**What was wrong.** `/dashboard/security` told customers 2FA was "not available yet" and not to rely on it, and sign-in issued a session on the password alone. On an app that holds customer wallets, that was the last self-service security gap. It is now closed.

| Piece | File | Behaviour |
|---|---|---|
| TOTP | `src/lib/totp.ts` | dependency-free RFC 6238: base32, six-digit codes, ±1 step window, constant-time compare |
| Enrolment, recovery, challenges | `src/lib/two-factor.ts` | AES-256-GCM secret, ten single-use recovery codes, hashed challenge tokens |
| Enrol / confirm / disable | `src/app/api/security/2fa/{start,confirm,disable}/route.ts` | session-authenticated; disable needs the password **and** a code |
| Sign-in second step | `src/app/api/auth/2fa/route.ts` | spends the challenge; shares the login rate-limit bucket |
| UI | `src/app/dashboard/security/TwoFactorCard.tsx`, `src/components/auth/AuthForm.tsx` | one-time secret + `otpauth` link, recovery list, and the code step at sign-in |
| Migration | `migrations/0015_two_factor.sql` | `user_two_factor`, `two_factor_recovery_codes`, `two_factor_challenges` |

**The decisions that matter**

- **Fail closed.** `TWO_FACTOR_KEY` (at least 16 characters) encrypts every secret. Without it an account that has 2FA enabled gets a **503 at sign-in and no session** — never a silent downgrade to password-only. Starting enrolment is refused too.
- **Replay is rejected, not merely windowed.** The accepted time-step is stored (`last_used_step`) and advanced with a conditional update, so the same six digits cannot be used twice inside their 30-second window — including the code used to confirm enrolment.
- **Challenges are single-use and cheap to revoke.** 32 random bytes go to the browser; only their SHA-256 is stored. Five-minute TTL, five wrong codes kill the challenge, a successful use consumes it with a conditional update.
- **Recovery is real.** Ten `abcde-fghij` codes, hashed, each spendable exactly once, shown once at confirmation and never again.
- **A stolen session cannot remove the factor.** Disable requires the password plus a current TOTP code or a recovery code.
- **No enumeration.** Unknown, expired, consumed and wrong all return one indistinguishable message; an outage returns 503 without spending one of the five attempts.

**The operational consequence:** rotating `TWO_FACTOR_KEY` makes every existing enrolment unreadable. Those accounts are locked out of the second step rather than let in without one — which is the intended failure, and why the runbook has a recovery procedure.

**Verified:** 886 tests / 100 files · typecheck · lint · build. New tests: `src/test/totp.test.ts` (8 — the RFC 6238 published vectors), `src/test/two-factor.test.ts` (14 — fail-closed, replay, single-use recovery, challenge hashing) and `src/test/auth-two-factor-login.test.ts` (3 — a correct password yields a challenge, not a session, and 503 when the server cannot check). Sabotage-proven twice: dropping `rejectUpToStep` and the conditional step advance fails two tests, and disabling the login branch issues a session it should not; both restored, all pass.

**Deliberately not done:** SMS or email one-time codes (an attacker with the password usually has the mailbox too), and an admin "reset 2FA" button. A reset is an audited operator action that needs an owner decision; the runbook describes how to handle a lockout manually in the meantime.

---

## 13. Fifth pass — a content security policy (30 Oct 2026)

The only security header missing from `src/proxy.ts` was the one that constrains where the browser may load anything from. It is now sent on every response:

```
default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self';
form-action 'self'; script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' data: https://fonts.gstatic.com;
img-src 'self' data: blob: https://images.pexels.com; connect-src 'self';
media-src 'self'; worker-src 'self' blob:; manifest-src 'self'; frame-src 'none'
```

> **Superseded in §22:** the two Google Fonts hosts are gone. The webfonts are self-hosted
> from `@fontsource` packages, so `style-src` and `font-src` are plain `'self'` now. The rest
> of the policy below is unchanged.

**What it actually stops.** A third-party origin cannot supply a script, style, font or image unless it is on that list; the page cannot be framed by anyone but itself; forms cannot post off-site; plugins/objects cannot load at all. That closes the "inject a tag from a supplier's error page" class and makes a new external dependency a visible, reviewable change rather than a silent one.

**What it does not stop, stated plainly.** `script-src` still includes `'unsafe-inline'`, so HTML injection that gets past React's escaping would still execute. Next.js emits its own inline bootstrap, the home page emits JSON-LD, and `BuildGuard` installs a stale-bundle check before hydration; a nonce-based policy would force every page to render dynamically and would still need those scripts rewritten to carry the nonce. That is a real follow-up, not a one-line change, and it is recorded here rather than pretended away.

**Environment differences are deliberate and tested.** Development adds `'unsafe-eval'` and `ws:`/`wss:` for hot reload; production has neither. The embedded preview keeps `frame-ancestors *` (and continues to omit `X-Frame-Options`) so the Arena viewer can frame the demo; a real deployment keeps `'self'`. `isEmbeddedPreviewHost` is anchored so `e2b.app.evil.com` does not match.

**Drift is the failure mode, so the tests read the sources.** `src/test/content-security-policy.test.ts` parses the policy and compares it with `layout.tsx` (since §22: that no Google Fonts host is
linked) and `next.config.ts` (`images.remotePatterns`), so adding an image host in one place and forgetting the other fails locally instead of silently blocking the image in production. It also fails if a form posts off-origin, if a wildcard appears in a script/style/image/font/connect source, or if a directive is emitted empty.

**Verified:** 896 tests / 101 files · typecheck · lint · build. Booted `next start` and checked the real headers on `/`, `/login`, `/pricing` and `/api/health`, and with `Host: 3000-abc.e2b.app` to confirm the preview branch (`frame-ancestors *`, no `X-Frame-Options`). Sabotage-proven: removing the Pexels host and hard-coding `frame-ancestors *` fails three tests; restored, all pass.

---

## 14. Sixth pass — installable app and a careful service worker (30 Oct 2026)

The app can now be installed, and survives a dead connection without pretending to work offline.

| Piece | File | Notes |
|---|---|---|
| Manifest | `src/app/manifest.ts` | generated route, so the name and description cannot drift from the metadata; `display: standalone`, cream theme |
| Icons | `public/icons/*` | 192 and 512 from the existing brand shield, plus a padded 512 `maskable` |
| Offline page | `src/app/offline/page.tsx` | static, no account data, `noindex` |
| Service worker | `public/sw.js` | versioned cache; see the rules below |
| Registration | `src/components/system/ServiceWorkerRegistration.tsx` | production only, two seconds after paint, failure is silent |

**The cache rules are the design.** A service worker outlives the tab and is shared by every profile on the device, so a careless cache is a data leak rather than a performance tweak. It caches exactly two things:

1. the offline fallback page, which contains no account data;
2. content-hashed `/_next/static/` assets and the app icons.

Navigations are network-first and **never** written to the cache. `/api` is skipped on every method. A failed navigation falls back to `/offline`; a failed asset is returned as-is and not cached, because an error page stored under an asset URL would break the app until the next version bump. The cache is capped at 80 entries and wiped on `VERSION` change.

**No offline money.** There is no background sync, no queued purchase, no push. A wallet that replays a payment after reconnecting is a double-spend risk, so the app simply requires the network to move money — the offline page says so.

**Verified:** 907 tests / 102 files · typecheck · lint · build. New tests execute `public/sw.js` in a Worker sandbox with a fake Cache API rather than grepping it: install precaches only the three files, API/POST/cross-origin requests are not intercepted, a navigation response is never stored, a repeated hashed asset is served without a second fetch, a 500 is not cached, and an older cache version is deleted on activate. The manifest test reads the PNG headers and fails if a declared size no longer matches the file. Sabotage-proven: dropping the method guard and caching navigations each fail a test. Also checked live with `next start`: `/manifest.webmanifest`, `/offline`, `/sw.js` and all three icons return 200 with the manifest linked in the HTML.

---

## 15. Seventh pass — the gift-card explainer page (30 Oct 2026)

Gift cards were live and sold from the dashboard with no page explaining them, so the rules only surfaced at the moment of purchase. `/gift-cards` now exists: how it works in three steps, the six rules in full, what a gift card is *not*, and the questions people actually ask.

**The copy is generated from the code that enforces it.** The amount range and twelve-month validity moved into `src/lib/gift-card-rules.ts`, which the checkout validates against and the page renders. The rules the page states come from `redeemGiftCard` and `refundGiftCard`: one redemption for the whole amount, validity one year, non-refundable, cannot redeem your own card, recipient needs an account, and the recipient email is a record rather than a delivery address — the buyer sends the code themselves.

`src/test/gift-card-page.test.tsx` renders the page and fails if the range stops matching the constants, if the checkout starts hard-coding numbers instead of using them, if the copy stops saying "not refundable" or "one redemption", if it promises to email the code, or if the buy button bypasses `/login?next=…`. Sabotage-proven in both directions: hard-coding the range in `gift-cards.ts` and rewriting the copy to "refundable if unused" each fail a test.

**Also wired:** the page is in the sitemap and linked from the footer's Services column, so it is reachable without typing the URL — the same defect the footer comment already records for the help centre and testimonials.

**Verified:** 913 tests / 103 files · typecheck · lint · build. `next start` checked `/gift-cards` = 200 with the canonical tag, the footer link on `/`, and the sitemap entry. The supplier-secrecy scan covers the new page; an early draft said "no supplier is involved" and was rewritten, because that scan is right that even naming the category tells a customer something.

---

## 16. Eighth pass — verified-purchase reviews (30 Oct 2026)

Customers had no way to record what happened after an order, and the site's only "feedback" was curated marketing copy. Reviews now exist, with three constraints that are structural rather than editorial:

| Rule | Where it lives |
|---|---|
| Only the account that bought the order can review it | the order lookup includes `userId`, so someone else's order is indistinguishable from a missing one |
| Only a `delivered` or `completed` order can be reviewed | `REVIEWABLE_STATUSES`; refunded, cancelled, processing and failed orders are refused |
| One review per order, enforced by a unique index | `product_reviews_order_id_key`, plus a check before the insert |
| Nothing is public until an operator publishes it | every review starts `pending`; the public list selects `status = 'published'` only |
| Every decision is audited | `moderateReview` writes `review.publish` / `review.reject` with the note |

**What is deliberately absent.** No seed data, no imported reviews, no "example" quotes and nothing generated — when there are none, `/reviews` says so in as many words. The public list carries **no customer identity at all**: not a name, not an initial, not a masked email. A wallet is a financial account; a review is not a reason to publish who holds one. Operators see the account in `/admin/reviews`, because judging a review means knowing whose order it came from.

**Where it surfaces.** `/reviews` (public, published only), `/dashboard/reviews` (write one, and see your own status with the reason if it was not published), `/admin/reviews` (queue with waiting / published / not-published / all tabs), plus a footer link and a sitemap entry.

**Moderation policy, documented rather than implied:** publish when the review is about a real experience and contains no contact details, credentials, other people's data or abuse; reject with a note the customer can read. Editing a review's words is not offered, and should not be done in SQL either — the audit trail says what was decided, not what was rewritten.

**Verified:** 942 tests / 106 files · typecheck · lint · build. New tests: the eligibility matrix (another account's order, five non-delivered statuses, duplicate attempt), input bounds, publish/reject with audit, a second decision refused, and two page renders proving the public page shows published reviews only and no identity while the queue shows the account. Sabotage-proven twice: making the public list read pending reviews fails three tests, and dropping the delivery check fails the eligibility test. Migration `0016` applied in all four PGlite fixtures.

---

## 17. Ninth pass — every service shows its own icon (30 Oct 2026)

**The report.** "Under email otp all the services doesn't use their logo icon" — so the whole
service vocabulary was audited, surface by surface, against what actually renders.

### What the audit found

| Defect | Where | Why it mattered |
|---|---|---|
| The service page had **no icon at all** | `/email-otp`, `/esim`, `/proxies`, `/virtual-numbers`, `/gift-cards`; the dashboard sections for inbox, accounts, data, gift cards, bulk and scheduled orders | the cards that link to a service showed its artwork; the page it opened did not, so the two surfaces did not look like the same product |
| A silent **wrong-logo fallback** | `src/components/ServiceIcon.tsx` — `FALLBACK_IMAGE = "/images/services/virtual-numbers.png"` | any unmapped or misspelt slug drew the **virtual-numbers** artwork, so an e-mail page could show a number icon indefinitely |
| A silent **wrong-network fallback** | `src/components/NetworkBadge.tsx` — `return <BrandIcon brand="airtel" …>` | every provider without a wordmark entry rendered **Airtel's** logo. Four providers exist today so it never showed; a fifth would have displayed a rival network's mark |

All three are now impossible rather than merely fixed: `ServiceIcon` renders a neutral, named
tile and logs in development instead of borrowing another service's art, `NetworkBadge` is an
exhaustive `Record<AirtimeProvider, …>` (a new provider fails typecheck until it has its own
mark), and the site heroes plus the dashboard headers use the service's own artwork through
`ServiceTitle`.

### Surface-by-surface result

| Surface | Renders | Verdict |
|---|---|---|
| `/` — service cards, quick picker, price rows | `ServiceIcon` (own artwork / real marks) | correct |
| `/` — platform marquee | `BrandIcon` real marks | correct |
| `/pricing` — group headings | `ServiceIcon` | correct |
| `/digital-services` | `ServiceIcon` → real marks (Netflix, Spotify, YouTube, Disney+, ChatGPT, Canva) | correct |
| `/email-otp`, `/esim`, `/proxies`, `/virtual-numbers`, `/gift-cards` | hero `ServiceIcon` | **added** |
| `/accounts` | hero `ServiceIcon` **added**; listings use `PlatformBadge` real marks | fixed |
| `/dashboard`, `/dashboard/services` | `ServiceIcon` / `BrandIcon` / `NetworkBadge` | correct |
| `/dashboard/{inbox,accounts,data,gift-cards,bulk-orders,scheduled}` | `ServiceTitle` with the section's artwork | **added** |
| `/dashboard/digital`, `/dashboard/data` | per-service mark; `NetworkBadge` per plan | correct |
| Dashboard sidebar and bottom tabs | `ServiceIcon size="xs"` | correct |
| `/admin/*` | service names only; no logo is claimed anywhere | nothing to verify |
| Transactional email | Pryva's own mark only | deliberate — no third-party logo is reproduced in email |

### Where a real mark does not exist, and what is shown instead

`BRAND_MARKS` holds 36 official marks generated by `scripts/extract-brand-marks.mjs` from
`simple-icons` (CC0), `@iconify-json/logos` (CC0) and `devicon` (MIT); Pryva's own nine
catalogue services use nine distinct 3D artwork files. Five brands publish **no mark those sets
may redistribute**, and both sets were re-checked in this pass: `siDisneyplus` does not exist
and the `logos` set has no Disney icon. Those five render a wordmark tile in the brand's own
colours — `WORDMARK_BRANDS` — and a test pins that list to exactly these five, so a brand with a
real mark can never be painted as a wordmark and a brand without one can never be invented:

| Brand | Why | Shown as |
|---|---|---|
| Disney+ | withdrawn from `simple-icons`; absent from the CC0 `logos` set | wordmark tile, `#0E1C6B` gradient |
| Outlook (Microsoft) | not in either set | wordmark tile, `#0F6CBD` gradient |
| MTN, Glo, 9mobile | no redistributable logo | wordmark tile in each carrier's own colours (Airtel *does* ship a mark and uses it) |

Nothing here was redrawn by eye or generated with an image model — the header of
`src/lib/brand-marks.ts` forbids it, and it is the reason this section exists rather than a set
of invented logos.

**Verified:** 953 tests / 107 files · typecheck · lint · build. New file
`src/test/service-logos.test.tsx` (11 tests) asserts that each catalogue service resolves to its
own artwork file and no two share one, that the nine files exist and are byte-distinct, that every
third-party product resolves to a real mark and never to artwork, that an unknown key draws
neither (`not-a-service` must not emit `/images/services/`), that all four networks get their own
badge, that every platform the explorer or the accounts grid can show renders something with an
accessible name, that the wordmark list is exactly the five brands above, and that each of the
twelve service surfaces still contains its icon — the last one is a source-level check because
rendering those pages needs a database. `src/test/logo-removal.test.tsx` keeps its original
assertions unchanged; Pryva's own catalogue still uses its 3D artwork, which remains the right
answer now that the audit has established there is no official mark for those services.

---

## 18. Tenth pass — the homepage, deduplicated (30 Oct 2026)

**The report:** services were appearing twice on the homepage. They were appearing up to three
times, and one of the repeats had a stale price in it.

| Repeat | What was on the page | Now |
|---|---|---|
| Quick service picker | numbers, eSIM, proxies and Email OTP as four cards, sitting **directly above** the nine-card grid that contains the same four | removed — the grid is the list |
| Price list | the same four services again, with the same four `from` prices the cards above already show, and the same icons | removed; the panel keeps only what the cards do not say — which plans are priced inside the dashboard — plus the link to the full list and a new link to `/status` |
| Accounts platform chips | Facebook, Instagram, TikTok, X as chips, while the platform marquee **40 px below** shows the same marks at the same size | chips removed; the marquee is the strip |
| Section numbering | `06 / Pricing` was followed by `08 / Questions` — nothing on the page was 07 | `07 / Questions` |

The homepage is now 918 lines (was 1005), 10 sections (was 11), and draws **nine service
artworks instead of seventeen** — one `ServiceIcon` per catalogue service. The pages it links to
are unchanged; `/pricing` still carries the full list, so nothing was lost but the repetition.

**What the page still needs — measured, not guessed.** `next.config.ts` sets
`images.unoptimized: true`, so every service icon is served as its full-size PNG: the nine
files total **2,197 KB** to fill slots between 32 px and 64 px. The categories artwork adds
1.2 MB and the flag set 2.3 MB (not used on the homepage). Switching those nine to generated
64/128 px WebP derivatives would take the same page from ~2.2 MB of icon bytes to roughly 40 KB,
and it is the largest improvement available on this page — larger than any further copy or
layout change. It is not done here because it touches `ServiceIcon`, the artwork tests and a
build step, and belongs in its own pass.

**Verified:** 955 tests / 107 files · typecheck · lint · build. New assertions in
`src/test/homepage.test.tsx`: each of the nine artwork files appears in exactly one `<img>` on
the page (sabotage-proven — adding a second `ServiceIcon` fails it with "appears 2 time(s)"), and
the section eyebrow numbers run 01–07 with no gap. The existing eighteen homepage assertions —
nine services present, no dashboard link for a signed-out visitor, `₦1,340` from the catalogue,
no price on a free inbox, the fulfilment-allowlist agreement — all still hold.

---

## 19. Eleventh pass — the artwork stops shipping at full size (30 Oct 2026)

Continuing the homepage assessment from §18, item 1: the icons were the heaviest thing on the
busiest page.

**Why it was happening.** `next.config.ts` sets `images.unoptimized: true`, so `next/image` hands
the browser the file it is given. Every service icon is a 512×512 PNG master of 220–270 KB, drawn
into slots of 20, 32, 48 and 64 px. The nine icons on the homepage came to **2,197 KB** of PNG to
paint nine thumbnails, and the four category images added another 1.1 MB.

**What changed.** `scripts/build-service-artwork.mjs` (`npm run artwork:build`) writes 64, 128 and
192 px WebP derivatives next to each master, and `src/lib/service-artwork.ts` builds the `srcSet`.
`ServiceIcon` and `CategoryIcon` render a plain `<img>` — not `next/image`, which cannot offer a
`srcSet` when the optimiser is off — with `sizes` set to the slot width, so a 48 px slot on a 2×
screen takes the 128 px file and nothing larger. The master PNG stays as the `src`, so a browser
that will not take a WebP still works, and the masters remain the source of truth.

| | Before | After |
|---|---|---|
| Nine homepage icons | 2,197 KB (PNG masters) | **6 KB** at 64 px, ~12 KB at 128 px |
| Every derivative, both folders (39 files) | 3,325 KB of masters | **71 KB** of WebP |
| Largest single icon request | 270 KB | 3.3 KB |

The derivatives are committed, so a deploy never depends on the script having run. They are
generated output: regenerate after changing a master, never edit one by hand.

**Verified:** 959 tests / 107 files · typecheck · lint · build. Four new assertions in
`src/test/service-logos.test.tsx` are on bytes rather than intent, because this regression is
invisible — the page looks identical at 3,000 KB and at 6 KB: a derivative exists at every width,
none is over 20 KB, the rendered `<img>` carries `srcSet` + `sizes="48px"` + the PNG fallback, and
the nine 64 px icons total under 20 KB (sabotage-proven: dropping the `srcSet` fails with
"expected … to contain 'srcSet='").

### Not done: the hero photo (assessment item 2)

The hero is still `https://images.pexels.com/...`, and it could not be brought in-house from here:
this sandbox has no outbound access to `images.pexels.com` (`curl` fails at TLS with
`SSL_ERROR_SYSCALL`), so the file cannot be copied into `public/`. Until it is local, the remote
host has to stay in both `next.config.ts` (`images.remotePatterns`) and the CSP
(`img-src https://images.pexels.com`). Two ways to finish it:

1. **Owner drops the original file in** `public/images/hero/` (it is 1080×1260 today) — then I
   generate 640/1080 WebP copies, point `PHOTOS.hero` at them, and delete both the remote pattern
   and the CSP allowance. That is the strictly better outcome: no third-party host on the LCP
   element.
2. **Authorise a replacement** and I generate one locally — but that replaces a real photograph of
   a person with a synthetic one, which is a branding decision, not a technical one.

---

## 20. Twelfth pass — the site on a phone (30 Oct 2026)

**The report:** on a phone, the visitor had to adjust the zoom to use the site. That is three
separate faults, and only the third one is a layout bug.

| Cause | Measured | Fixed by |
|---|---|---|
| The small print was genuinely tiny | **369** separate `text-[0.5…0.79rem]` declarations across 72 files, the smallest **9.3 px** — a badge, a table header, a price note | two named steps, `text-micro` and `text-meta`, with a **13 px floor below `sm`**. Desktop keeps the sizes the design was drawn at; a phone never goes below 13 px |
| iOS zoomed the page itself | `.field` is `0.92rem` = **14.7 px**. Safari zooms the whole page in when a focused control is under 16 px, and does not zoom back out | form controls set to **16 px below `sm`** — the threshold, not a preference |
| Tables were clipped, not scrollable | six tables in `overflow-hidden` wrappers (admin orders, users, audit, reconciliation; cookie and refund policy), two with `whitespace-nowrap` cells | `overflow-x-auto` plus a `min-w` on each, so the columns scroll instead of disappearing |

**Also corrected while in there:** an explicit `viewport` export (`width=device-width`,
`initial-scale=1`, `viewport-fit=cover` for the dashboard's bottom tab bar, `colorScheme: "light"`
so iOS does not draw dark controls on a cream page) — and deliberately **no** `maximum-scale` or
`user-scalable: no`, because disabling pinch-zoom is how a fix like this usually makes a page
unusable for the people who need it; `-webkit-text-size-adjust: 100%` so rotating the device does
not re-inflate the type; `overflow-x: clip` on `html` as a guard against a stray decorative blur
(`clip`, not `hidden`, so the sticky header and fixed tab bar keep working); the hero call-to-action
rows wrap instead of overflowing at 320 px; and the wallet's three money columns stack to one on a
phone, where three columns of truncated currency hid the balance.

**Verified:** 968 tests / 108 files · typecheck · lint · build. New file
`src/test/mobile-layout.test.tsx` (9 tests): no unprefixed text under 0.8 rem anywhere (only
`sm:`-prefixed desktop overrides may be small), both steps defined with the 639 px floor, controls
at 16 px, `overflow-x: clip` and not `hidden`, no `maximumScale`/`userScalable`, no table wrapped in
`overflow-hidden`, and every table in a scroll container. Sabotage-proven three ways: dropping the
16 px rule, re-clipping the orders table (fails both table tests), and re-adding one `text-[0.7rem]`
all fail.

**What this pass could not do:** there is no browser in this environment, so this is verified at the
source, CSS and served-HTML level — not by looking at a 360 px render. The counts above are real;
the pixel result is not something I can claim to have seen. A pass on an actual handset is still
worth doing before calling mobile done.

---

## 21. Thirteenth pass — gift cards are not a service (30 Oct 2026)

**The report:** gift cards should not be part of the categories, because they are not services.
Correct — nothing is fulfilled and nothing is supplied: a gift card is wallet credit Pryva issues
itself, the moment it is paid for.

| Where gift cards were a "service" | Now |
|---|---|
| `serviceDefinitions` in `catalog.ts` — one of the nine service cards, with `fromPrice`, `unit`, highlights and FAQs | removed from the catalogue; the homepage grid shows **eight** services |
| `EXPLORER_CATEGORIES` — a "Gift cards · Pryva wallet credit" chip, plus a card in that category | chip and card removed; the dashboard hub no longer offers a gift-cards category |
| Dashboard sidebar, under **Buy**, pointing at the services hub with `category: "gift-cards"` | links straight to `/dashboard/gift-cards`, still in the sidebar and the command palette |
| Footer, under **Services** | moved to the product links, beside Pricing |
| Terms: "…data plans, gift cards, bulk ordering…" | the sentence now lists the services, then says Pryva also issues gift cards that carry wallet credit |

`/gift-cards`, `/dashboard/gift-cards`, the purchase and redeem routes, the email template and the
sitemap entry are untouched — the product exists and works; only its classification changed. The
`gift-cards` string stays in `ServiceSlug`, `service-timeouts` and the pricing markup table as an
internal identifier, which is why old orders and the gift-card rules still typecheck.

**One deliberate exception:** `/status` still lists "Gift cards — Available". That page reports
*which products can be ordered and delivered* (its own words), not which services exist, and a
visitor looking for whether gift cards work should not have to guess. Say the word and the row goes.

**Verified:** 969 tests / 108 files · typecheck · lint · build. Assertions moved rather than
deleted: the homepage test now requires eight service names and asserts gift cards is absent from
the grid, the explorer test asserts there is no `gift-cards` category and no item, and the
dashboard-shell test asserts the sidebar has no `category: "gift-cards"` while `/dashboard/gift-cards`
is still reachable. `/gift-cards` remains in the footer (moved column) and in the sitemap.

---

## 22. Fourteenth pass — fonts on our own origin, and structured data (30 Oct 2026)

Two upgrades, both invisible in a screenshot and measurable in the source of the page.

**1. The webfonts are self-hosted.** `<head>` used to carry two `preconnect` hints and a
`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?...">` for Plus Jakarta Sans
and Instrument Serif. That is a third-party request **on the critical path**: the browser
cannot finish painting until Google answers, and the only reason the Content-Security-Policy
named `style-src https://fonts.googleapis.com` and `font-src https://fonts.gstatic.com` was
that stylesheet. Both families ship as npm packages, so `src/app/layout.tsx` now imports the
eight cuts the design actually uses (`@fontsource/plus-jakarta-sans` 300–800, and
`@fontsource/instrument-serif` 400 + italic) and the `<link>` tags are gone.

- Files are emitted into `/_next/static/media` with the same hashed, `immutable` caching as
  every other asset — verified: `Cache-Control: public, max-age=31536000, immutable`,
  `content-type: font/woff2`.
- Each `@fontsource` file declares a `unicode-range`, so a browser downloads latin, and
  latin-ext only when a glyph outside it appears. The naira sign (`U+20A6`) lives in
  latin-ext (`U+20A0-20AB`), so prices keep the right face instead of falling back.
- `font-display: swap` is preserved from the packages, so text paints immediately.
- **The policy narrowed rather than widened:** `style-src 'self' 'unsafe-inline'` and
  `font-src 'self' data:`. Two hosts left the CSP, and a test now fails if a `<link>` to
  either host comes back.

**2. Structured data for the publisher, not just the page.** The homepage emitted `FAQPage`
and nothing else, so a crawler learned the questions but not who was answering them. The root
layout now emits `Organization` (name, url, logo, description, `areaServed` Nigeria) and
`WebSite` (`inLanguage: en-NG`, `publisher` by `@id` reference) from `src/lib/structured-data.ts`.

It deliberately claims **nothing Pryva cannot show**: no `aggregateRating`, no `review`, no
`foundingDate`, no `address`, no `telephone`, no `sameAs`. A rich result won for an invented
rating is the same lie as a seeded testimonial, in a format crawlers believe — a test pins
each of those keys as absent. The serializer escapes `<`/`>` so a string can never close its
own `<script>` block.

**Verified:** 976 tests / 109 files · typecheck · lint · build. Served HTML checked directly:
no third-party host in `<head>`, two JSON-LD blocks (`Organization` + `WebSite`, plus the
homepage's `FAQPage`), 8 self-hosted `@font-face` families in the emitted CSS, no
`fonts.googleapis`/`fonts.gstatic` anywhere in it, and the CSP header narrowed as above.
HTML weight unchanged at 55 KB gzipped.

---

## 23. Fifteenth pass — the security and money-operations request (30 Oct 2026)

Seven things were asked for. Six are done and one needs an answer from the owner
(§23.8). Every claim below is enforced by code or a test, not by intent.

### 23.1 Temporary inboxes cannot create an account

`src/lib/disposable-domains.ts` refuses ~150 providers at signup, matched on the
domain and any subdomain of it, before the row is created — so the answer never
reveals whether an address has been tried before. The refusal explains itself:
a deleted inbox takes the verification link, receipts and every password reset
with it. Deliberately conservative — gmail, outlook, yahoo, icloud, proton, zoho,
gmx, yandex, aol and ordinary company domains are untouched, and a test pins that
list. It is a speed bump, and the module says so.

### 23.2 Accounts lock after repeated wrong passwords

8 consecutive failures lock the account for 30 minutes (`migrations/0017`,
`src/lib/account-lockout.ts`). The counter lives on the account row, so it
survives a deploy and a second instance — the rate limiter's fixed windows never
could. The increment and the lock are one atomic `UPDATE`; a locked account is
refused before the password is compared; the reply is the same `429` +
`Retry-After` the limiter already uses, so the status cannot be used to learn
which emails have accounts. A successful sign-in clears the run; a completed
password reset clears the lock, because proving the mailbox beats a forgotten
password. The admin user list shows the state, read-only.

### 23.3 Terms rewritten to match the product

Fifteen dated, anchored clauses replacing eleven generic paragraphs that predated
gift cards, 2FA, lockout, verified reviews, withdrawals and the switched-off
products. It rendered in `prose` classes from a typography plugin this build does
not load, so it was unstyled body text — that is gone too. It claims no
registration number, no address and no delivery guarantee, and a test keeps the
limitations stated.

### 23.4 Backups, and a drill that has to be run

Two copies, because they fail differently: the provider's PITR covers every
write; `npm run db:backup` writes a verified logical snapshot (manifest + one line
per table, SHA-256 per table) that survives the provider. The archive is data
only — the schema is replayed from `migrations/`. `npm run db:restore` orders
tables parents-first from the foreign keys recorded in the manifest, runs in one
transaction, verifies every checksum before writing a row, and refuses three
ways: no `--confirm-restore`, a non-empty target, or the live database. The
backup verifies the file before pruning anything older. RUNBOOK §8a has the
drill, and its log starts empty **because it has not been run yet**.

### 23.5 A security pass that found three real things

`SECURITY.md` is the audit: threat model, controls by file, known gaps, and the
operator checklist for the things code cannot do. It opens with "no system is
unhackable" because that is true.

Found and fixed:
* **administrators were not required to have 2FA** while being able to approve
  withdrawals and issue refunds — now enforced on admin pages *and* admin APIs,
  with `ADMIN_2FA_REQUIRED=false` as the documented recovery hatch;
* **`zod < 4.6.6`** reachable through `@vercel/functions → @vercel/oidc →
  @vercel/cli-config` (GHSA-mrhx-c7xc-m3w5) — pinned by an `overrides` entry;
  `npm audit --omit=dev` now reports **0 vulnerabilities**, and CI fails on a high
  advisory;
* **no CI gate on advisories at all** — added to `ci.yml` with `--audit-level=high`
  on production dependencies only.

`public/.well-known/security.txt` publishes the contact, with an expiry a test
keeps in the future.

### 23.6 Each transaction tracked, and a daily close

`/admin/transactions` lists every wallet movement with its account, running
balance and reference — read-only, because a ledger you can edit is not a ledger.
The nightly job (`/api/cron/nightly`, 02:20 Lagos) writes a `reconciliation_runs`
row per day with the day's deposits, spend, refunds, gift cards and withdrawals,
and checks the ledger invariant for **every** account: each `balance_after` must
follow from the previous one (debits down, credits and refunds up), and the last
must equal `users.wallet_balance`. A break marks the day `attention` and lists the
accounts with the difference. The row is written as `running` before the work, so
a crash leaves evidence rather than nothing, and a re-run corrects the same day.

Vercel's Hobby plan allows two cron entries and this app needs three tasks, so
they are one job with a defined order: close the books, drain the email outbox,
then sweep refunds. Each step is isolated.

### 23.7 What was deliberately not automated

The **external** side of reconciliation. Comparing our deposits with Paystack's
settled total is an operator step, and both the admin page and the runbook say so
rather than implying a check that never ran. Same for SPF/DKIM/DMARC, PITR and the
WAF: they are DNS records, provider settings and money, not code.

### 23.8 Social platforms, shown without pretending

TikTok and X are in the footer now, with real brand marks from `BRAND_MARKS`
(the extractor's marks, never drawn by hand). The profiles do not exist yet, so
each link goes to the platform's own home page and its label — the tooltip and
what a screen reader hears — says "Pryva on X — profile coming soon". That is the
compromise the owner chose over an icon that points nowhere or a link to a 404.

`src/lib/social.ts` holds the whole decision: `profileUrl` is the real account and
is `null` today; `socialHref` and `socialIsPlaceholder` read it; the footer renders
through them. Setting one field switches a placeholder to a real link with no
other edit, and the module's comment says so.

**Verified:** 1,067 tests / 117 files · typecheck · lint · build · `npm audit`
clean for production dependencies.

---

## 24. Sixteenth pass — security is part of settings (30 Oct 2026)

**The correction.** "Security should be under settings on user profile, they can't be
separate." It was right, and not only cosmetically: password, two-factor and
sessions are three properties of one account, and the app had them on two sibling
pages that both sounded correct. A customer who wanted to turn on two-factor went
to Settings — the page that already held the password field — and found no mention
of it. The separate page also made the two halves disagree about what "Settings"
meant.

**What is there now.** `/dashboard/settings` is the whole account page, in one
scroll: the `?require=2fa` explanation (when the administrator area has just
refused someone), the profile and password form, then `#security` — the two-factor
card, the active-sessions card, what we do on our side and the habits section that
used to be the separate page's only other content. `src/app/dashboard/settings/
SecuritySection.tsx` reads the 2FA state itself and is a server component, so the
client cards kept their boundaries; `TwoFactorCard` and `SessionsCard` moved with
`git mv`, not copied, so there is one implementation of each.

**What did not change.** Every link that already pointed at the old address still
arrives: `src/app/dashboard/security/page.tsx` is now a redirect to
`/dashboard/settings` **carrying the query string and the `#security` anchor**
forward. That matters for the case that is easy to miss — an administrator
without 2FA is bounced out of `/admin/*` to `?require=2fa&next=…`, so a plain
redirect would drop the explanation and land them on a page that looks unrelated
to what just happened. Command palette entry renamed to "Security settings" and
pointed at the section; the sidebar has **Settings** and no Security row; the
terms page links to the anchor; `src/lib/auth.ts` bounces to the section directly.

**Tests.** `src/test/legacy-redirects.test.ts` (new, 4) covers the forwarding
helper directly; `src/test/settings-security.test.tsx` (new, 7) pins the shape: the
section renders on the settings page with `id="security"`, both cards and the
guidance came across, the sidebar has no security destination, the old route is a
redirect that keeps the query and the anchor and no longer renders a heading, the
moved files exist only in their new directory, the admin bounce carries the
anchor, and the palette points at the section. Three older tests asserted the
two-page layout and were rewritten rather than deleted: the sidebar list, the
terms href, and the admin-2FA banner — that banner's text is now read out of the
settings page.

**Verified:** 1,078 tests / 119 files · typecheck · lint · build. The
query-forwarding — the part with any logic in it — moved to
`securityRedirectTarget` in `src/lib/legacy-redirects.ts` and is tested directly
(empty, the admin bounce, repeated keys, blank values, escaping), because the
page cannot be exercised over HTTP here: middleware answers `/dashboard/*`
before the page runs, so an unauthenticated `curl /dashboard/security` gets
`307 → /login?next=%2Fdashboard` for every dashboard route alike. That is stated
rather than papered over; the signed-in path is the unit-tested helper plus a
two-line page.
