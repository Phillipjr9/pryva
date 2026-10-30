# Pryva — verified status review

**Date:** 30 October 2026 (updated) · **Commit:** `19113f0` (`main`) · **Branch reviewed:** `arena/0c5fc242-pryva`
**Method:** every claim below was read out of the code or produced by running the project. Nothing is taken from `PLAN.md` without checking it first — and several `PLAN.md` entries turned out to be stale (section 4).

---

## 0. Health check (run in this checkout)

| Check | Result |
|---|---|
| `npm ci` | clean install, 534 packages |
| `npm run typecheck` | **0 errors** |
| `npm run lint` | **0 warnings/errors** |
| `npm test` | **855 tests / 95 files, all passing** (no `.skip`, no `.only`) |
| `npm run build` | **passes**; 70 API route handlers, 21 public pages, 17 dashboard pages, 10 admin pages |
| Boot with no `DATABASE_URL` | `npm start` → `/api/health` = `{"status":"healthy","mode":"preview"}`; `/`, `/pricing`, `/status`, `/accounts` = 200; `/dashboard` = 307 (auth redirect) |

Codebase size: ~51,800 lines under `src/`, 95 modules in `src/lib/`, 18 database tables, 15 migrations (`0000`–`0014`).
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
| 3 | **Reviews & ratings** | nothing (`/testimonials` is curated copy, not user reviews) |
| 4 | **Coupons / discount codes** | only supplier promo codes on the marketplace; no Pryva coupon system |
| 5 | **Support tickets** | `/dashboard/support` + `/admin/messages` handle flat `contact_messages`; no threads, priorities or SLA |
| 6 | **Two-factor authentication** | `src/app/dashboard/security/page.tsx:51` literally says "not available yet"; no TOTP library |
| 7 | **SMS / WhatsApp notifications** | nothing (no Termii/Twilio/WhatsApp client) |
| 8 | **PWA** | no manifest, no service worker, no offline page (the preview cookie bridge is not a PWA) |
| 9 | **Product analytics / Web Vitals** | nothing — no GA4, no `@vercel/analytics`, no `web-vitals` |
| 10 | ~~**Admin audit log**~~ | **Built in the second pass** — `admin_audit_log` (migration `0014`), `/admin/audit`, `GET /api/admin/audit` |
| 11 | **Admin payment-audit view** | no dedicated reconciliation screen. "Failed orders" is already `/admin/orders?status=review`; the audit log now covers who acted, not what still needs reconciling |
| 12 | **Paid inbox tier** | schema supports `tier='paid'`, the code only issues `free`; price needs the supplier's real `priceNgn` |
| 13 | **CSP** | no `Content-Security-Policy` header anywhere (`src/proxy.ts` ships the other headers) |
| 14 | **Dockerfile** | CI (`.github/workflows/ci.yml`) and an operations runbook (`RUNBOOK.md`) were added in these passes; no Dockerfile — deployment is Vercel-only |
| 15 | **Gift-card explainer page** | no `/gift-cards` marketing page; one blog post (`gift-cards-for-teams`) is all there is |
| 16 | **Self-service account deletion** | deliberately returns 503; panel points at support |

Rough sizing: 1–4 and 15 are S–M; 5, 10, 11, 13 are M; 6, 7, 8 are M; 9 is S.

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

10. **Deployment wiring lives only in the Vercel dashboard.** Build command, migration gating, env scoping and the cron cadence are not in the repo, and there is no CI to catch a regression — see PR #17 below.

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
4. 🟡 **Finish the money loop** — the admin audit log is done; still open: reconcile the supplier balance, a dedicated reconciliation view, and enforcing email verification on signup.
5. **Then growth features** — referrals, coupons, reviews, wishlist, 2FA, PWA, analytics. These are additive; none of them unblocks revenue the way 1–4 do.

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

### How this was verified

```sh
npm ci && npm run typecheck && npm run lint && npm test && npm run build
PORT=3000 npm start   # then curl /, /api/health, /status, /pricing, /accounts, /dashboard
grep -rni "referral|wishlist|coupon|totp|termii|whatsapp|manifest|gtag|audit_log" src
find src/app/api/admin -name route.ts; cat vercel.json; cat next.config.ts
```

Feature claims marked "absent" mean zero matching code in `src/`; "built" means the file was read, not that a live third-party call was made. No live supplier, Paystack or Resend credentials are present in this environment, so nothing here proves a third-party integration works — only that the code path exists.
